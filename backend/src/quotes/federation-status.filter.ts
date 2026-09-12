import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Request, Response } from 'express';

/**
 * Every non-2xx from the quotes federation route carries ONE envelope
 * (Amendment 01 A7 — Customer-Ops records `federated.project_ops = failed`
 * with a reason and re-runs only failed adapters):
 *
 *   { status: 'failed', code, reason, http_status }
 *
 * `code` is stable and machine-readable (VALIDATION, UNSUPPORTED_CURRENCY,
 * VERSION_MISMATCH, PDF_FETCH_FAILED, PDF_INVALID, PDF_STORE_FAILED,
 * FEDERATION_ACTOR_REQUIRED, UNAUTHENTICATED, NOT_FOUND, INTERNAL …).
 * Bound with @UseFilters on the federation controller only, so the app-wide
 * error shape is untouched. 5xx are still forwarded to Sentry (parity with the
 * global SentryFilter this filter shadows for these routes).
 */
@Catch()
export class FederationStatusFilter implements ExceptionFilter {
  private readonly logger = new Logger(FederationStatusFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { httpStatus, code, reason } = FederationStatusFilter.classify(exception);

    if (httpStatus >= 500) {
      this.logger.error(
        `${req?.method} ${req?.originalUrl ?? req?.url} → ${httpStatus} ${code}: ${reason}`,
        exception instanceof Error ? exception.stack : undefined,
      );
      Sentry.captureException(exception);
    } else {
      this.logger.warn(`${req?.method} ${req?.originalUrl ?? req?.url} → ${httpStatus} ${code}: ${reason}`);
    }

    res.status(httpStatus).json({ status: 'failed', code, reason, http_status: httpStatus });
  }

  /** Pure so it is unit-testable without an ArgumentsHost. */
  static classify(exception: unknown): { httpStatus: number; code: string; reason: string } {
    if (exception instanceof HttpException) {
      const httpStatus = exception.getStatus();
      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        // Already our envelope (federationError()).
        if (b.status === 'failed' && typeof b.code === 'string') {
          return { httpStatus, code: b.code, reason: String(b.reason ?? exception.message) };
        }
        const message = b.message;
        const reason = Array.isArray(message)
          ? message.map(String).join('; ')
          : typeof message === 'string'
            ? message
            : exception.message;
        return { httpStatus, code: FederationStatusFilter.codeFor(httpStatus, b.error), reason };
      }
      return {
        httpStatus,
        code: FederationStatusFilter.codeFor(httpStatus),
        reason: typeof body === 'string' ? body : exception.message,
      };
    }
    return {
      httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL',
      reason: 'Unexpected error while federating the quote; retry federation.',
    };
  }

  private static codeFor(httpStatus: number, error?: unknown): string {
    switch (httpStatus) {
      case HttpStatus.BAD_REQUEST:
        return 'VALIDATION';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHENTICATED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'RATE_LIMITED';
      default:
        return typeof error === 'string' && error.trim()
          ? error.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
          : httpStatus >= 500
            ? 'INTERNAL'
            : 'ERROR';
    }
  }
}
