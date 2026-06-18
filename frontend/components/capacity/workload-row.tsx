"use client";

/**
 * WorkloadRow — one person's line on the resource-planning board: name +
 * initials avatar, the LoadBar meter, a right-aligned committed/capacity
 * read-out with a percentage chip, the task count, an "N unestimated" warning
 * badge (so hidden, unsized work is visible), an over-allocated flag, and an
 * optional "edit capacity" affordance (rendered only when the caller passes
 * `onEdit`, which the page gates on ADMIN/MANAGER).
 *
 * Pure presentational. The page owns data + RBAC; this just renders a row.
 */

import { AlertTriangle, Pencil, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtHours, loadBand, type UserCapacityRow } from "@/lib/capacity-api";
import { cn } from "@/lib/utils";
import { LoadBar } from "./load-bar";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const PCT_CHIP: Record<ReturnType<typeof loadBand>, string> = {
  under: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  near: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  over: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const AVATAR_TONE: Record<ReturnType<typeof loadBand>, string> = {
  under: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  near: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  over: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export function WorkloadRow({
  row,
  onEdit,
}: {
  row: UserCapacityRow;
  /** When provided, renders an "edit capacity" pencil (ADMIN/MANAGER only). */
  onEdit?: (row: UserCapacityRow) => void;
}) {
  const band = loadBand(row.utilizationPct, row.overAllocated);

  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-border/60 bg-card px-4 py-3 transition-colors hover:border-border hover:bg-accent/40 sm:flex-row sm:items-center sm:gap-4">
      {/* Identity */}
      <div className="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            AVATAR_TONE[band],
          )}
          aria-hidden
        >
          {initials(row.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {row.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {row.taskCount} {row.taskCount === 1 ? "task" : "tasks"}
          </p>
        </div>
      </div>

      {/* Meter — takes the slack */}
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <LoadBar
          utilizationPct={row.utilizationPct}
          overAllocated={row.overAllocated}
          className="flex-1"
        />
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums",
            PCT_CHIP[band],
          )}
        >
          {row.overAllocated && <Flame className="h-3 w-3" />}
          {Math.round(row.utilizationPct)}%
        </span>
      </div>

      {/* Numbers + flags */}
      <div className="flex items-center justify-between gap-3 sm:w-64 sm:shrink-0 sm:justify-end">
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">
            {fmtHours(row.committedHours)}
          </span>
          {" / "}
          {fmtHours(row.capacityHours)}
        </span>

        {row.overAllocated && (
          <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-1.5 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-3 w-3" />
            Over
          </span>
        )}

        {row.unestimatedCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
            title={`${row.unestimatedCount} assigned task${
              row.unestimatedCount === 1 ? " has" : "s have"
            } no time estimate — committed hours may understate the real load`}
          >
            <AlertTriangle className="h-3 w-3" />
            {row.unestimatedCount} unestimated
          </span>
        )}

        {onEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            onClick={() => onEdit(row)}
            aria-label={`Edit ${row.name}'s weekly capacity`}
            title="Edit weekly capacity"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
