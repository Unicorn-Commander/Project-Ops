/**
 * NestJS exception filter that forwards 5xx errors to Sentry / Glitchtip.
 *
 * 4xx is intentionally not reported — those are the user's fault and would
 * just be noise. Anything that comes through as a non-HttpException is
 * always reported (uncaught code paths).
 */

import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request, Response } from 'express';

@Catch()
export class SentryFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SentryFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

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

    super.catch(exception, host);
  }
}
