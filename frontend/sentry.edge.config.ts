/**
 * Sentry / Glitchtip — Edge runtime (middleware.ts, edge route handlers).
 *
 * We don't currently use the edge runtime, but Next.js's withSentryConfig
 * expects this file to exist alongside server + client configs. No-op
 * when SENTRY_DSN is unset.
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
