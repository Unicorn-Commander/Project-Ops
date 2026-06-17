"use client";

// Dashboard error boundary — renders inside the dashboard chrome (sidebar +
// top bar stay put), so it's compact. Covers every /dashboard route that
// doesn't declare a closer boundary.

import { ErrorFallback } from "@/components/error-fallback";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorFallback error={error} reset={reset} compact />;
}
