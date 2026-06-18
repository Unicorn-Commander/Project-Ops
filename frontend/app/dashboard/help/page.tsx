"use client";

import { Suspense } from "react";
import { HelpCenter } from "@/components/help/help-center";

/**
 * Help center page (`/dashboard/help`).
 *
 * `HelpCenter` calls `useSearchParams()` (to read the `?c=`/`?a=` deep-link
 * params), which the App Router requires be wrapped in a Suspense boundary —
 * otherwise the build bails the whole route to client-side rendering. The
 * fallback is a lightweight skeleton matching the eventual layout.
 */
export default function HelpPage() {
  return (
    <Suspense fallback={<HelpSkeleton />}>
      <HelpCenter />
    </Suspense>
  );
}

function HelpSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-12 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-10 max-w-2xl animate-pulse rounded-md bg-muted" />
      <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
        <div className="h-80 animate-pulse rounded-xl bg-muted" />
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
