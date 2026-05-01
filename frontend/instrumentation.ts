/**
 * Next.js calls register() once per runtime so the SDK can hook into the
 * server before any user code runs. The `process.env.NEXT_RUNTIME` switch
 * routes to the right Sentry init file (Node vs Edge).
 *
 * @sentry/nextjs also exports onRequestError so 5xx server-side errors
 * surface even when caught by Next's own error handlers.
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
