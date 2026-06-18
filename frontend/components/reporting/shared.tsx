"use client";

/**
 * Shared primitives for the Reporting suite (portfolio / profitability /
 * throughput). Centralises the chart palette, tooltip/axis styling, stat
 * tiles, chart card chrome, the section tab control, and the date-range
 * control so the three report surfaces read as one analytics product.
 *
 * Recharts discipline (mirrors `components/dashboard/project-charts.tsx`):
 *   - chart colours are hard-coded Tailwind-500 hex (CSS vars don't propagate
 *     into <svg>);
 *   - every chart lives in a fixed-height div and is given a NUMERIC
 *     ResponsiveContainer height (never "100%");
 *   - every series sets isAnimationActive={false};
 *   - pie radii are numeric px.
 */

import * as React from "react";
import {
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  subMonths,
  endOfDay,
} from "date-fns";
import { Card } from "@/components/ui/card";
import { iconWellClass } from "@/lib/badge-styles";

// ---------------------------------------------------------------------------
// Chart palette — Tailwind 500-shade hex, kept in JS so Recharts renders
// straight SVG fills (CSS variables don't propagate into <svg>).
// ---------------------------------------------------------------------------
export const COLOUR = {
  blue: "#3b82f6",
  amber: "#f59e0b",
  violet: "#8b5cf6",
  emerald: "#10b981",
  orange: "#f97316",
  zinc: "#71717a",
  rose: "#e11d48",
} as const;

/**
 * Status → fill, matching the kanban / project-charts vocabulary so a project
 * reads the same colour everywhere. Falls back to zinc for unknown values.
 */
export const STATUS_COLOUR: Record<string, string> = {
  NEW: COLOUR.blue,
  IN_PROGRESS: COLOUR.amber,
  UNDER_REVIEW: COLOUR.violet,
  COMPLETED: COLOUR.emerald,
  ON_HOLD: COLOUR.orange,
  ARCHIVED: COLOUR.zinc,
  // Task statuses (used by throughput's tasksByStatus).
  PENDING: COLOUR.blue,
  BLOCKED: COLOUR.rose,
  CANCELLED: COLOUR.zinc,
  WAITING_FOR_CLIENT: COLOUR.violet,
};

/** Human label for a status enum value (falls back to a Title-Cased form). */
export function statusLabel(status: string): string {
  const MAP: Record<string, string> = {
    NEW: "New",
    IN_PROGRESS: "In progress",
    UNDER_REVIEW: "In review",
    COMPLETED: "Completed",
    ON_HOLD: "On hold",
    ARCHIVED: "Archived",
    PENDING: "Pending",
    BLOCKED: "Blocked",
    CANCELLED: "Cancelled",
    WAITING_FOR_CLIENT: "Waiting for client",
  };
  if (MAP[status]) return MAP[status];
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Deterministic colour for an arbitrary label that isn't a known status. */
export function colourForIndex(i: number): string {
  const ramp = [
    COLOUR.blue,
    COLOUR.emerald,
    COLOUR.violet,
    COLOUR.amber,
    COLOUR.orange,
    COLOUR.rose,
    COLOUR.zinc,
  ];
  return ramp[i % ramp.length];
}

export const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  color: "var(--color-popover-foreground)",
  fontSize: "12px",
} as const;

export const AXIS_TICK = {
  fill: "var(--color-muted-foreground)",
  fontSize: 12,
} as const;

export type IconTone = Parameters<typeof iconWellClass>[0];

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------
export function StatCard({
  label,
  value,
  sub,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: IconTone;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground truncate">
            {label}
          </p>
          <p className="text-2xl font-bold text-foreground mt-1 font-mono tabular-nums">
            {value}
          </p>
          {sub && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{sub}</p>
          )}
        </div>
        <div
          className={`h-10 w-10 shrink-0 rounded-lg flex items-center justify-center ${iconWellClass(tone)}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Chart card chrome — header (icon + title + subtitle) over a fixed-height body
// ---------------------------------------------------------------------------
export function ChartHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

export function ChartCard({
  icon,
  title,
  subtitle,
  /** Tailwind height class for the body (e.g. "h-64"). */
  bodyHeightClass = "h-64",
  children,
  footer,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  bodyHeightClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <ChartHeader icon={icon} title={title} subtitle={subtitle} />
      <div className={bodyHeightClass}>{children}</div>
      {footer}
    </Card>
  );
}

/** A small colour-swatch legend row used under donut/stacked charts. */
export function ChartLegend({
  items,
}: {
  items: { key: string; label: string; value?: string; fill: string }[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-xs">
      {items.map((d) => (
        <span key={d.key} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ background: d.fill }}
          />
          <span className="text-muted-foreground">{d.label}</span>
          {d.value !== undefined && (
            <span className="font-mono tabular-nums font-medium text-foreground">
              {d.value}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section tabs — segmented control (mirrors the utilization PeriodHeader)
// ---------------------------------------------------------------------------
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { key: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1"
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.key;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date-range control — period presets resolved to { from, to } ISO.
// Presets keep parity with the utilization page's PeriodHeader.
// IMPORTANT: never resolve `periodRange()` during render — it reads
// `new Date()`. Callers compute it in an effect (see each section component).
// ---------------------------------------------------------------------------
export type RangeKey = "month" | "last30" | "quarter" | "ytd" | "last12m" | "all";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "last12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
];

/**
 * Resolve a preset key to ISO `{ from, to }`. "All time" passes nothing.
 *
 * Reads `new Date()`, so callers MUST invoke this inside an effect — never in
 * a render path or a useState initializer (hydration rule / React #418).
 */
export function resolveRange(key: RangeKey): { from?: string; to?: string } {
  if (key === "all") return {};
  const now = new Date();
  const to = endOfDay(now).toISOString();
  let from: Date;
  switch (key) {
    case "month":
      from = startOfMonth(now);
      break;
    case "last30":
      from = subDays(now, 30);
      break;
    case "quarter":
      from = startOfQuarter(now);
      break;
    case "ytd":
      from = startOfYear(now);
      break;
    case "last12m":
      from = subMonths(now, 12);
      break;
    default:
      return {};
  }
  return { from: from.toISOString(), to };
}

export function DateRangeControl({
  value,
  onChange,
}: {
  value: RangeKey;
  onChange: (k: RangeKey) => void;
}) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            value === opt.key
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
