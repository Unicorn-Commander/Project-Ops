"use client";

/**
 * LoadBar — a single horizontal utilization meter (committed vs capacity),
 * coloured by load band:
 *   green  (<85%)      — headroom
 *   amber  (85–100%)   — at risk
 *   red    (>100%)     — over-allocated
 *
 * The fill width is clamped to the bar; when over-allocated we also paint a
 * hatched "overflow" cap past 100% and a 100% marker tick, so a row that's
 * blown past capacity reads instantly as red-over-the-line rather than just a
 * full bar. Pure presentational — all numbers are passed in.
 */

import { loadBand, type LoadBand } from "@/lib/capacity-api";
import { cn } from "@/lib/utils";

const FILL: Record<LoadBand, string> = {
  under: "bg-emerald-500",
  near: "bg-amber-500",
  over: "bg-rose-500",
};

const TRACK = "bg-muted";

export function LoadBar({
  utilizationPct,
  overAllocated,
  className,
  height = "h-2.5",
}: {
  utilizationPct: number;
  overAllocated?: boolean;
  className?: string;
  /** Tailwind height class — defaults to a slim h-2.5 row meter. */
  height?: string;
}) {
  const band = loadBand(utilizationPct, overAllocated);
  // Clamp the in-track fill to 100%; the overflow is drawn separately.
  const fillPct = Math.max(0, Math.min(100, utilizationPct));
  const isOver = band === "over";

  return (
    <div
      className={cn("relative w-full rounded-full", TRACK, height, className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(utilizationPct)}
      aria-label={`${Math.round(utilizationPct)}% utilized`}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 rounded-full transition-[width]",
          FILL[band],
        )}
        style={{ width: `${fillPct}%` }}
      />
      {/* Over-allocation: hatched cap pinned to the right edge so the bar reads
          as "spilling over" the 100% line. */}
      {isOver && (
        <div
          className="absolute inset-y-0 right-0 w-2 rounded-r-full bg-rose-600/60"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.45) 2px, rgba(255,255,255,0.45) 4px)",
          }}
        />
      )}
      {/* Subtle 100% marker when not yet over (helps read the amber band). */}
      {!isOver && utilizationPct > 0 && (
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-border" />
      )}
    </div>
  );
}
