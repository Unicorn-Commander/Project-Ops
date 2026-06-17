"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function TimesheetsError({
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
      title="Couldn't load timesheets"
      description="We hit an error loading the timesheet view. The team has been notified. Try again, and quote the reference below if it persists."
    />
  );
}
