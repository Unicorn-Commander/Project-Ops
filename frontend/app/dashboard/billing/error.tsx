"use client";

import { ErrorFallback } from "@/components/error-fallback";

export default function BillingError({
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
      title="Couldn't load billing"
      description="We hit an error loading the billing view. The team has been notified. Try again, and quote the reference below if it persists."
    />
  );
}
