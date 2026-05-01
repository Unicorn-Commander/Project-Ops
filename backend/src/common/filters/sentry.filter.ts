/**
 * NestJS exception filter that forwards 5xx errors to Sentry / Glitchtip.
 *
 * 4xx is intentionally not reported — those are the user's fault and would
 * just be noise. Anything that comes through as a non-HttpException is
 * always reported (uncaught code paths).
 *
 * Wraps Nest's BaseExceptionFilter so the default error response shape is
 * preserved AFTER we capture. BaseExceptionFilter needs the HttpAdapter
 * passed in via the constructor — without it the filter throws
 * `TypeError: Cannot read properties of undefined (reading 'isHeadersSent')`
 * on every error path (which we hit on every dashboard load post-v1.6.5
 * until this was fixed in v1.6.12).
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { Request } from 'express';

@Catch()
export class SentryFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryFilter.name);

  constructor(
    // Optional + Inject so this filter still works when instantiated
    // directly via `new SentryFilter()` (which is what useGlobalFilters
    // does today). The recommended pattern would be to bind it via the
    // APP_FILTER provider so DI hands us the adapter — but the manual
    // path is simpler for one filter.
    @Optional() @Inject(HttpAdapterHost) httpAdapterHost?: HttpAdapterHost,
  ) {
    super(httpAdapterHost?.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag('http.method', req?.method);
        scope.setTag('http.url', req?.originalUrl ?? req?.url);
        // The user is set by Passport — exists on most authenticated routes.
        const user = (req as any)?.user;
        if (user?.id) {
          scope.setUser({
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
          });
        }
        Sentry.captureException(exception);
      });
    }

    // Hand off to BaseExceptionFilter to produce the actual HTTP response.
    super.catch(exception, host);
  }
}
