/**
 * Sentry / Glitchtip — Node runtime (Next.js SSR / Route Handlers).
 *
 * The frontend Next.js server runs SSR + a small set of Route Handlers
 * (auth callbacks, static API). Errors here look almost exactly like
 * the dedicated NestJS backend's errors — both feed the same
 * Glitchtip project. No-op when SENTRY_DSN is unset.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "production",
    release: process.env.SENTRY_RELEASE || process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE || "0",
    ),
    sendDefaultPii: false,
  });
}
