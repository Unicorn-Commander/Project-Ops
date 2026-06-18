"use client";

/**
 * Profitability report — margin and realization by project over a date range.
 *
 *   - A date-range control.
 *   - Workspace totals tiles (billable, billed, margin, realization).
 *   - Margin-by-project bar (top projects; red bars for negative margin).
 *   - A table: billable / billed / cost / margin / margin% / realization.
 *
 * Money fields may be null for non-privileged callers. When the workspace
 * totals come back with null money we render a "no financial visibility"
 * surface instead of a wall of em-dashes.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/use-toast";
import {
  getProfitabilityReport,
  formatHours,
  formatMoney,
  formatPct,
  type ProfitabilityReport,
} from "@/lib/reporting-api";
import {
  COLOUR,
  TOOLTIP_STYLE,
  AXIS_TICK,
  StatCard,
  ChartHeader,
  DateRangeControl,
  resolveRange,
  type RangeKey,
} from "./shared";
import {
  CircleDollarSign,
  Receipt,
  TrendingUp,
  Gauge,
  BarChart3,
  AlertTriangle,
  Lock,
} from "lucide-react";

// Truncate a long project title for an axis tick.
function shortTitle(title: string): string {
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

export function ProfitabilitySection() {
  const { toast } = useToast();
  const [range, setRange] = useState<RangeKey>("ytd");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [report, setReport] = useState<ProfitabilityReport | null>(null);

  const fetchData = useCallback(async (key: RangeKey) => {
    setLoading(true);
    setError(false);
    // resolveRange() reads new Date() — safe here (effect/handler, not render).
    const { from, to } = resolveRange(key);
    try {
      setReport(await getProfitabilityReport({ from, to }));
    } catch (err) {
      console.error("Error loading profitability report:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [fetchData, range]);

  const handleRetry = () => {
    toast({ title: "Retrying", description: "Reloading profitability…" });
    fetchData(range);
  };

  const totals = report?.totals;
  const projects = useMemo(() => report?.projects ?? [], [report]);

  // Whether this caller can see money at all (drives the "no visibility" state).
  const moneyVisible =
    totals != null &&
    (totals.billableAmount != null ||
      totals.billedAmount != null ||
      totals.margin != null);

  // Margin-by-project chart: top 12 by absolute margin, skipping null-money rows.
  const marginData = useMemo(() => {
    return projects
      .filter((p) => p.margin != null)
      .map((p) => ({
        key: p.projectId,
        name: shortTitle(p.title),
        fullName: p.title,
        margin: Math.round((p.margin as number) * 100) / 100,
      }))
      .sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))
      .slice(0, 12);
  }, [projects]);

  if (loading) return <ProfitabilitySkeleton range={range} onChange={setRange} />;

  if (error) {
    return (
      <div className="space-y-6">
        <Header range={range} onChange={setRange} />
        <Card className="p-6">
          <EmptyState
            icon={AlertTriangle}
            iconTone="rose"
            title="Couldn’t load profitability"
            body="Something went wrong fetching the profitability report. Check your connection and try again."
            action={
              <Button onClick={handleRetry} variant="outline">
                Try again
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      <Header range={range} onChange={setRange} />

      {!moneyVisible ? (
        <Card className="p-6">
          <EmptyState
            icon={Lock}
            iconTone="amber"
            title="No financial visibility"
            body="Profitability figures are limited to managers and admins. Ask a workspace admin if you need access to billing and cost data."
          />
        </Card>
      ) : (
        <>
          {/* Totals tiles */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Billable value"
              value={formatMoney(totals?.billableAmount)}
              sub={`${formatHours(totals?.billableHours)} billable`}
              tone="blue"
              icon={CircleDollarSign}
            />
            <StatCard
              label="Billed"
              value={formatMoney(totals?.billedAmount)}
              sub={`Realization ${formatPct(totals?.realization)}`}
              tone="emerald"
              icon={Receipt}
            />
            <StatCard
              label="Margin"
              value={formatMoney(totals?.margin)}
              sub={`Cost basis ${formatMoney(totals?.costBasis)}`}
              tone="violet"
              icon={TrendingUp}
            />
            <StatCard
              label="Margin %"
              value={formatPct(totals?.marginPct)}
              sub="Margin ÷ billed"
              tone="amber"
              icon={Gauge}
            />
          </div>

          {/* Margin by project */}
          <Card className="p-6">
            <ChartHeader
              icon={BarChart3}
              title="Margin by project"
              subtitle={
                marginData.length > 0
                  ? `Top ${marginData.length} project${marginData.length === 1 ? "" : "s"} by margin contribution`
                  : "No billed projects in this period"
              }
            />
            <div className="h-72">
              {marginData.length > 0 ? (
                <ResponsiveContainer width="100%" height={288}>
                  <BarChart
                    data={marginData}
                    margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
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
                      angle={-30}
                      textAnchor="end"
                      height={64}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tick={AXIS_TICK}
                      tickFormatter={(v) => formatMoney(Number(v))}
                      width={72}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--color-muted)" }}
                      formatter={(value) => [formatMoney(Number(value)), "Margin"]}
                      labelFormatter={(_label, payload) => {
                        const p = payload?.[0]?.payload as
                          | { fullName: string }
                          | undefined;
                        return p?.fullName ?? "";
                      }}
                      contentStyle={TOOLTIP_STYLE}
                    />
                    <Bar dataKey="margin" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      {marginData.map((d) => (
                        <Cell
                          key={d.key}
                          fill={d.margin < 0 ? COLOUR.rose : COLOUR.emerald}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState
                  icon={BarChart3}
                  iconTone="zinc"
                  title="No margin to chart yet"
                  body="Once projects are billed in this period, their margin contribution appears here."
                  className="h-full border-0"
                />
              )}
            </div>
          </Card>

          {/* Profitability table */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  Profitability by project
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Billable value, billed, cost basis, margin and realization per
                  project.
                </p>
              </div>
            </div>
            {hasProjects ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="text-left font-medium py-2 pr-4">Project</th>
                      <th className="text-right font-medium py-2 px-4">Billable</th>
                      <th className="text-right font-medium py-2 px-4">Billed</th>
                      <th className="text-right font-medium py-2 px-4">Cost</th>
                      <th className="text-right font-medium py-2 px-4">Margin</th>
                      <th className="text-right font-medium py-2 px-4">Margin %</th>
                      <th className="text-right font-medium py-2 pl-4">Realization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => {
                      const negative = p.margin != null && p.margin < 0;
                      return (
                        <tr
                          key={p.projectId}
                          className="border-b border-border/60 last:border-0"
                        >
                          <td className="py-2.5 pr-4">
                            <span className="font-medium text-foreground line-clamp-1">
                              {p.title}
                            </span>
                            <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
                              {formatHours(p.billableHours)} billable
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                            {formatMoney(p.billableAmount)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                            {formatMoney(p.billedAmount)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-muted-foreground">
                            {formatMoney(p.costBasis)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                              negative
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-foreground"
                            }`}
                          >
                            {formatMoney(p.margin)}
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono tabular-nums ${
                              negative
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatPct(p.marginPct)}
                          </td>
                          <td className="py-2.5 pl-4 text-right font-mono tabular-nums text-muted-foreground">
                            {formatPct(p.realization)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {totals && (
                    <tfoot>
                      <tr className="border-t-2 border-border text-sm font-semibold">
                        <td className="py-2.5 pr-4 text-foreground">Total</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                          {formatMoney(totals.billableAmount)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                          {formatMoney(totals.billedAmount)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-muted-foreground">
                          {formatMoney(totals.costBasis)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                          {formatMoney(totals.margin)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                          {formatPct(totals.marginPct)}
                        </td>
                        <td className="py-2.5 pl-4 text-right font-mono tabular-nums text-foreground">
                          {formatPct(totals.realization)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            ) : (
              <EmptyState
                icon={TrendingUp}
                iconTone="zinc"
                title="No billable activity"
                body="Projects with billable time in this period will show their margin and realization here."
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Header({
  range,
  onChange,
}: {
  range: RangeKey;
  onChange: (k: RangeKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Margin, realization, and cost recovery across billed projects.
      </p>
      <DateRangeControl value={range} onChange={onChange} />
    </div>
  );
}

function ProfitabilitySkeleton({
  range,
  onChange,
}: {
  range: RangeKey;
  onChange: (k: RangeKey) => void;
}) {
  return (
    <div className="space-y-6">
      <Header range={range} onChange={onChange} />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-20" />
              </div>
              <Skeleton className="h-10 w-10 rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-72 w-full" />
      </Card>
      <Card className="p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-64 w-full" />
      </Card>
    </div>
  );
}
