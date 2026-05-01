/**
 * Sentry / Glitchtip — browser-side initialisation.
 *
 * Loaded by Next.js for every client bundle. Reports uncaught errors,
 * unhandled promise rejections, and any error boundary the app owns.
 * No-op when NEXT_PUBLIC_SENTRY_DSN is unset.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "production",
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    // Browser tracing is off by default — Glitchtip supports it but the
    // payloads are heavy and we mostly care about errors here. Flip on
    // per-environment if we want flame charts for slow dashboard pages.
    tracesSampleRate: parseFloat(
      process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE || "0",
    ),
    // Don't ship document.cookie / localStorage / form values — those
    // contain JWTs, names, project descriptions, etc.
    sendDefaultPii: false,
    // Ignore noise from extensions + intermittent network failures the
    // user can do nothing about.
    ignoreErrors: [
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
      "Non-Error promise rejection captured",
      // Browser extensions inject these; not our bug.
      /chrome-extension:\/\//,
      /^moz-extension:\/\//,
    ],
  });
}
