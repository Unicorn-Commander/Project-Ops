"use client";

// App-level error boundary — catches errors in any route segment that
// doesn't have its own closer boundary. Renders full-height (these routes,
// e.g. the landing + auth pages, have no dashboard chrome of their own).

import { ErrorFallback } from "@/components/error-fallback";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} />;
}
