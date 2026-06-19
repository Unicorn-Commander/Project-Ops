"use client";

/**
 * StatCard — an elevated, friendly metric tile for the portal summary rows.
 *
 * A tinted icon well, a big legible value, a quiet label, and an optional
 * footer link. Distinct from the staff dashboard's denser stat cards: more
 * padding, a softer hover lift, and an accent hairline at the top so the
 * summary row reads as a welcoming overview rather than a data grid.
 */

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { iconWellClass } from "@/lib/badge-styles";

type IconWellTone = Parameters<typeof iconWellClass>[0];

export interface StatCardProps {
  /** Tinted icon. */
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Icon well tone (also tints the top hairline). Default "primary". */
  tone?: IconWellTone;
  /** The quiet caption above/below the value. */
  label: string;
  /** The headline value (string already formatted, or a number). */
  value: React.ReactNode;
  /** Optional secondary line under the value (e.g. "across 3 projects"). */
  hint?: React.ReactNode;
  /** Optional footer link. */
  href?: string;
  /** Footer link label. Default "View all". */
  linkLabel?: string;
  className?: string;
}

/** Maps an icon tone to a matching top-hairline accent colour. */
const TONE_BAR: Record<string, string> = {
  blue: "bg-blue-500/60",
  amber: "bg-amber-500/60",
  emerald: "bg-emerald-500/60",
  rose: "bg-rose-500/60",
  violet: "bg-violet-500/60",
  orange: "bg-orange-500/60",
  zinc: "bg-zinc-500/40",
  primary: "bg-primary/60",
};

export function StatCard({
  icon: Icon,
  tone = "primary",
  label,
  value,
  hint,
  href,
  linkLabel = "View all",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "po-card group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card",
        "shadow-sm transition-shadow duration-200 hover:shadow-md",
        className,
      )}
    >
      {/* Accent hairline */}
      <span
        aria-hidden
        className={cn("absolute inset-x-0 top-0 h-0.5", TONE_BAR[tone] ?? TONE_BAR.primary)}
      />

      <div className="flex items-start justify-between gap-4 p-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-bold tracking-tight text-foreground">
            {value}
          </p>
          {hint && (
            <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
          )}
        </div>
        <span
          className={cn(
            "inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl",
            iconWellClass(tone),
          )}
        >
          <Icon className="h-6 w-6" strokeWidth={1.9} />
        </span>
      </div>

      {href && (
        <Link
          href={href}
          className="mt-auto inline-flex items-center gap-1.5 border-t border-border/70 px-6 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {linkLabel}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}
