"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function TimeError({
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
      title="Couldn't load time entries"
      description="We hit an error loading your time entries. The team has been notified. Try again, and quote the reference below if it persists."
    />
  );
}
