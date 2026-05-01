/**
 * Sentry / Glitchtip initialisation.
 *
 * Imported as the very first line of main.ts so the SDK can hook the
 * Node runtime before NestJS boots. If `SENTRY_DSN` is empty (default),
 * Sentry is a no-op — error tracking is opt-in per environment.
 *
 * In production this points at the self-hosted Glitchtip on bigboy
 * (Sentry-protocol-compatible). See `docs/AI_ASSISTANT_DEMO.md` for
 * how the silent-failure bug class — failed tool calls being logged
 * as "ok" — is exactly what this catches.
 */

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.SENTRY_RELEASE || `project-ops-backend@${process.env.npm_package_version || 'dev'}`,
    // Glitchtip currently advertises a Sentry SDK ~v8 compat surface; tracing
    // is supported but expensive on a small server. Sample lightly.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    // Default Node integrations include onUncaughtException + onUnhandledRejection,
    // which is exactly what we want — silent process-level failures should
    // surface here.
    sendDefaultPii: false,
  });
}
