"use client";

/**
 * Branded fallback for Next.js `error.tsx` boundaries below the root layout.
 * Unlike `app/global-error.tsx` (which replaces the whole document), this one
 * renders inside the live layout, so it can use the design system + brand
 * fonts. Reports the error to Sentry/Glitchtip on mount and surfaces the
 * returned event id so users can quote it to support.
 *
 * Pass `compact` for per-route boundaries that render inside the dashboard
 * chrome (no full-height centering), or leave it off for top-level routes.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import * as Sentry from "@sentry/nextjs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RefreshCw } from "lucide-react";

export function ErrorFallback({
  error,
  reset,
  title = "Something went wrong",
  description = "Project Ops hit an unexpected error. The team has been notified. Try again, and if it keeps happening, contact support with the reference below.",
  compact = false,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    setEventId(Sentry.captureException(error));
  }, [error]);

  const reference = eventId ?? error.digest ?? null;

  return (
    <div
      className={
        compact
          ? "flex items-center justify-center py-16"
          : "flex min-h-screen items-center justify-center bg-background p-6"
      }
    >
      <Card className="flex max-w-lg flex-col items-center p-8 text-center">
        <span className="mb-5 inline-flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-border dark:bg-zinc-100">
          <Image
            src="/projectops-mascot.png"
            alt="Project Ops"
            width={56}
            height={56}
          />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        <Button className="mt-6" onClick={() => reset()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
        {reference && (
          <p className="mt-6 font-mono text-xs text-muted-foreground/70">
            Reference: {reference}
          </p>
        )}
      </Card>
    </div>
  );
}
