"use client";

/**
 * Root error boundary — catches errors thrown in the root layout itself,
 * which is the one place a normal `error.tsx` can't reach. Next.js renders
 * this in place of the entire app, so it must supply its own <html>/<body>
 * and cannot rely on the theme provider, fonts, or design-system components
 * being mounted. We keep it self-contained but on-brand (mascot + indigo
 * accent + calm copy) and inline the styles so it renders even if the CSS
 * bundle is what failed.
 *
 * The error is reported to Sentry/Glitchtip and the returned event id is
 * surfaced so a user can quote it to support.
 */

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    setEventId(Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#fafaf9",
          color: "#171717",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          padding: "1.5rem",
        }}
      >
        <div style={{ maxWidth: "32rem", textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/projectops-mascot.png"
            alt="Project Ops"
            width={72}
            height={72}
            style={{
              display: "block",
              margin: "0 auto 1.5rem",
              borderRadius: "0.75rem",
              backgroundColor: "#ffffff",
              boxShadow: "0 1px 0 0 #e4e4e7",
            }}
          />
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: "0 0 0.5rem",
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: "0.95rem",
              lineHeight: 1.6,
              color: "#52525b",
              margin: "0 0 1.5rem",
            }}
          >
            Project Ops hit an unexpected error and couldn&apos;t finish
            loading. The team has been notified. Try again, and if it keeps
            happening, contact support with the reference below.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              appearance: "none",
              border: 0,
              cursor: "pointer",
              backgroundColor: "#4f46e5",
              color: "#fafafa",
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "0.625rem 1.25rem",
              borderRadius: "0.5rem",
            }}
          >
            Try again
          </button>
          {(eventId || error.digest) && (
            <p
              style={{
                marginTop: "1.5rem",
                fontSize: "0.75rem",
                color: "#a1a1aa",
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              }}
            >
              Reference: {eventId ?? error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
