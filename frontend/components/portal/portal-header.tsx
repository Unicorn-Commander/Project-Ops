"use client";

/**
 * PortalHeader — the warm, branded hero that crowns the client portal.
 *
 * This is the first thing a client sees on the dashboard: a personal greeting,
 * their organisation, and a tasteful brand accent. It deliberately reads softer
 * and more spacious than the dense staff app — the portal is hospitality, not a
 * cockpit.
 *
 * HYDRATION (React #418): the greeting depends on `new Date()` (time of day) and
 * the name/org come from localStorage. Both differ between the server render and
 * the first client render, so everything client-derived is gated behind
 * `useHydrated()` — the server (and first client render) show a calm, generic
 * "Welcome back", and the personalised copy paints on the next tick. No mismatch.
 */

import * as React from "react";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

export interface PortalHeaderProps {
  /** The signed-in client's first name (from the persisted user). */
  firstName?: string | null;
  /** The client's organisation / workspace name, shown as the eyebrow. */
  orgName?: string | null;
  /**
   * Optional sub-copy under the greeting. Defaults to a warm, plain-language
   * line; pass your own to tailor per page.
   */
  subtitle?: React.ReactNode;
  /** Optional right-aligned content (e.g. a quick action). */
  actions?: React.ReactNode;
  /** Extra classes on the outer surface. */
  className?: string;
}

/** Time-of-day greeting. Only ever called after hydration. */
function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export function PortalHeader({
  firstName,
  orgName,
  subtitle,
  actions,
  className,
}: PortalHeaderProps) {
  const hydrated = useHydrated();

  // Pre-hydration: a steady, generic greeting that matches the server render.
  // Post-hydration: time-aware + personalised.
  const greeting = hydrated ? greetingFor(new Date()) : "Welcome back";
  const name = hydrated && firstName ? firstName.trim() : "";

  return (
    <section
      className={cn(
        // A soft branded band: the indigo primary at low opacity, fading to
        // the page background. Reads as a calm welcome mat, not a loud banner.
        "po-card relative overflow-hidden rounded-2xl border border-border/70",
        "bg-gradient-to-br from-primary/[0.08] via-card to-card",
        "px-6 py-7 sm:px-8 sm:py-9",
        className,
      )}
      aria-label="Welcome"
    >
      {/* Decorative accent — a faint glow in the corner, purely cosmetic. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {orgName && (
            <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
              />
              {orgName}
            </p>
          )}
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {greeting}
            {name ? (
              <>
                , <span className="text-primary">{name}</span>
              </>
            ) : (
              ""
            )}
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {subtitle ??
              "Here's everything happening across your projects — review work, approve deliverables, and keep your invoices in one calm place."}
          </p>
        </div>

        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
    </section>
  );
}
