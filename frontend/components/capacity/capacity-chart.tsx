"use client";

/**
 * CapacityChart — committed hours vs pro-rated capacity across the team, as a
 * grouped bar chart. Mirrors the verified Recharts-3 + React-19 config from
 * `components/dashboard/project-charts.tsx`:
 *   - <ResponsiveContainer> gets a NUMERIC height (NOT "100%") or it renders blank;
 *   - every <Bar> sets isAnimationActive={false};
 *   - chart colours are hard-coded Tailwind-500 hex (CSS vars don't reach <svg>).
 *
 * Each user is a category with two bars: capacity (zinc, the budget) and
 * committed (coloured by that person's load band — green/amber/red), so a
 * spike past its capacity sibling reads as over-allocation at a glance.
 */

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { loadBand, type UserCapacityRow } from "@/lib/capacity-api";

// Tailwind 500-shade hex (kept in JS so Recharts renders straight SVG fills).
const COLOUR = {
  emerald: "#10b981",
  amber: "#f59e0b",
  rose: "#e11d48",
  zinc: "#a1a1aa", // zinc-400 — the capacity "budget" bar, intentionally muted
} as const;

const BAND_COLOUR: Record<ReturnType<typeof loadBand>, string> = {
  under: COLOUR.emerald,
  near: COLOUR.amber,
  over: COLOUR.rose,
};

const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  color: "var(--color-popover-foreground)",
  fontSize: "12px",
} as const;

const AXIS_TICK = { fill: "var(--color-muted-foreground)", fontSize: 12 } as const;

/** Truncate long names so the X axis stays readable. */
function shortName(name: string): string {
  return name.length > 14 ? `${name.slice(0, 13)}…` : name;
}

export function CapacityChart({ rows }: { rows: UserCapacityRow[] }) {
  const data = useMemo(
    () =>
      rows.map((r) => ({
        key: r.userId,
        name: shortName(r.name),
        fullName: r.name,
        capacity: Math.round(r.capacityHours * 10) / 10,
        committed: Math.round(r.committedHours * 10) / 10,
        fill: BAND_COLOUR[loadBand(r.utilizationPct, r.overAllocated)],
      })),
    [rows],
  );

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Committed vs capacity
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.length > 0
              ? `Hours committed against available capacity across ${data.length} ${
                  data.length === 1 ? "person" : "people"
                }`
              : "No team members to chart"}
          </p>
        </div>
      </div>

      <div
        className="h-72"
        role="img"
        aria-label={
          data.length > 0
            ? `Committed hours against capacity per person: ${data
                .map((d) => `${d.fullName} committed ${d.committed} of ${d.capacity} hours`)
                .join("; ")}.`
            : "No team members to chart."
        }
      >
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height={272}>
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              barGap={2}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                vertical={false}
              />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
                interval={0}
              />
              <YAxis
                unit="h"
                tickLine={false}
                axisLine={false}
                tick={AXIS_TICK}
              />
              <Tooltip
                cursor={{ fill: "var(--color-muted)" }}
                formatter={(value, name) => [
                  `${Number(value).toFixed(1)}h`,
                  name === "committed" ? "Committed" : "Capacity",
                ]}
                labelFormatter={(_label, payload) =>
                  (payload?.[0]?.payload as { fullName?: string })?.fullName ??
                  String(_label)
                }
                contentStyle={TOOLTIP_STYLE}
              />
              <Legend
                formatter={(value) =>
                  value === "committed" ? "Committed" : "Capacity"
                }
                wrapperStyle={{ fontSize: 12 }}
              />
              {/* Capacity — the muted "budget" reference bar. */}
              <Bar
                dataKey="capacity"
                isAnimationActive={false}
                fill={COLOUR.zinc}
                radius={[4, 4, 0, 0]}
              />
              {/* Committed — coloured per-row by load band. */}
              <Bar
                dataKey="committed"
                isAnimationActive={false}
                radius={[4, 4, 0, 0]}
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            icon={BarChart3}
            iconTone="zinc"
            title="Nothing to chart"
            body="Committed-vs-capacity bars appear once the workspace has active members."
            className="h-full border-0"
          />
        )}
      </div>
    </Card>
  );
}
