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
 *
 * v1.6.17 — The default v10 integrations include OTel-driven
 * auto-instrumentation for HTTP/Express that patches every Express
 * layer and consumes the incoming request body to attach as span data.
 * That runs BEFORE NestJS's body-parser, so by the time NestJS reads
 * the stream it's already empty and every POST/PATCH 500s with
 * `InternalServerError: stream is not readable` (root in
 * `@sentry/core/.../integrations/express/patch-layer.js`). All MCP
 * write tools were silently broken between v1.6.5 and v1.6.16 because
 * of this. Fix: filter the HTTP-layer-patching integrations out.
 * We keep pure error capture (which is what we use Sentry for) and
 * lose the express auto-tracing (which we never queried).
 *
 * If we want tracing back later: add `@sentry/nestjs` properly +
 * register Sentry as a Nest module so its Express patch is sequenced
 * AFTER NestJS body-parser.
 */

import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

// Names of the default integrations that patch HTTP/Express layers and
// consume request bodies. Filtering them is the minimum-surgery fix.
const HTTP_LAYER_INTEGRATIONS = new Set([
  'Http',
  'Express',
  'Connect',
  'Fastify',
  'Koa',
  'NestJs',
  'NestJsFastify',
]);

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release:
      process.env.SENTRY_RELEASE ||
      `project-ops-backend@${process.env.npm_package_version || 'dev'}`,
    // Tracing is now off — the integrations that produce HTTP spans are
    // what break body-parser. Errors still flow via the SentryFilter +
    // process-level uncaught/unhandled handlers.
    tracesSampleRate: 0,
    integrations: (defaults) => defaults.filter((i) => !HTTP_LAYER_INTEGRATIONS.has(i.name)),
    sendDefaultPii: false,
  });
}
