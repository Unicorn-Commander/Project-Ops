"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function UtilizationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorFallback
      error={error}
      reset={reset}
      compact
      title="Couldn't load utilization"
      description="We hit an error building the utilization report. The team has been notified. Try again, and quote the reference below if it persists."
    />
  );
}
