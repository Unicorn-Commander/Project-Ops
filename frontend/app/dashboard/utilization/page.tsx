"use client";

/**
 * Utilization dashboard — billable-vs-non-billable, per-user utilization,
 * hours-by-project, and a WIP rollup, all keyed off a period selector.
 *
 * Read-only: every figure comes straight from the Time-Tracking report
 * endpoints (visibility-scoped server-side, so STAFF see only their own row
 * and managers see everyone — no client-side RBAC gating needed). The page
 * just renders whatever rows come back.
 *
 * Recharts usage mirrors `components/dashboard/project-charts.tsx`
 * exactly — chart colours are hard-coded Tailwind-500 hex (CSS vars don't
 * propagate into <svg>), charts live in fixed-height divs, and an EmptyState
 * stands in for an empty SVG.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  startOfWeek,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  subDays,
  endOfDay,
} from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/use-toast";
import { iconWellClass } from "@/lib/badge-styles";
import { useAuthStore } from "@/lib/store";
import {
  getUtilization,
  getRealization,
  getWip,
  getTimeEntries,
  secondsToHours,
  formatMoney,
  type UtilizationReport,
  type RealizationReport,
  type WipReport,
  type TimeEntry,
} from "@/lib/time-tracking-api";
import {
  Clock,
  CircleDollarSign,
  Gauge,
  Receipt,
  PieChart as PieIcon,
  BarChart3,
  FolderKanban,
  AlertTriangle,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Chart palette — Tailwind 500-shade hex, kept in JS so Recharts renders
// straight SVG fills (mirrors project-charts.tsx).
// ---------------------------------------------------------------------------
const COLOUR = {
  blue: "#3b82f6",
  amber: "#f59e0b",
  violet: "#8b5cf6",
  emerald: "#10b981",
  orange: "#f97316",
  zinc: "#71717a",
  rose: "#e11d48",
} as const;

const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  color: "var(--color-popover-foreground)",
  fontSize: "12px",
} as const;

const AXIS_TICK = { fill: "var(--color-muted-foreground)", fontSize: 12 } as const;

// ---------------------------------------------------------------------------
// Period presets → { from?, to? } ISO. "All time" passes nothing.
// ---------------------------------------------------------------------------
type PeriodKey =
  | "week"
  | "month"
  | "last30"
  | "quarter"
  | "ytd"
  | "all";

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
  { key: "quarter", label: "This quarter" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
];

function periodRange(key: PeriodKey): { from?: string; to?: string } {
  if (key === "all") return {};
  const now = new Date();
  const to = endOfDay(now).toISOString();
  let from: Date;
  switch (key) {
    case "week":
      from = startOfWeek(now, { weekStartsOn: 1 });
      break;
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
    default:
      return {};
  }
  return { from: from.toISOString(), to };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function UtilizationPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();

  const [period, setPeriod] = useState<PeriodKey>("month");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [utilization, setUtilization] = useState<UtilizationReport | null>(null);
  const [realization, setRealization] = useState<RealizationReport | null>(null);
  const [wip, setWip] = useState<WipReport | null>(null);
  const [entries, setEntries] = useState<TimeEntry[]>([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { from, to } = periodRange(period);
    try {
      const [utilRes, realRes, wipRes, entriesRes] = await Promise.allSettled([
        getUtilization({ from, to }),
        getRealization({ from, to }),
        getWip(),
        getTimeEntries({ from, to, limit: 200 }),
      ]);

      // If the core report (utilization) failed, treat the page as errored so
      // the user gets a retry rather than a half-empty dashboard. WIP/entries
      // are enrichment — tolerate their individual failure.
      if (utilRes.status === "rejected") {
        throw utilRes.reason;
      }

      setUtilization(utilRes.value);
      setRealization(realRes.status === "fulfilled" ? realRes.value : null);
      setWip(wipRes.status === "fulfilled" ? wipRes.value : null);
      setEntries(
        entriesRes.status === "fulfilled" ? entriesRes.value.data ?? [] : [],
      );
    } catch (err) {
      console.error("Error loading utilization dashboard:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleRetry = () => {
    toast({ title: "Retrying", description: "Reloading utilization data…" });
    fetchAll();
  };

  // --- Derived: headline totals (recompute utilization from summed hours) ---
  const rows = useMemo(() => utilization?.rows ?? [], [utilization]);
  const totalHours = useMemo(
    () => rows.reduce((s, r) => s + (r.totalHours ?? 0), 0),
    [rows],
  );
  const billableHours = useMemo(
    () => rows.reduce((s, r) => s + (r.billableHours ?? 0), 0),
    [rows],
  );
  const nonBillableHours = Math.max(0, totalHours - billableHours);
  const overallUtilization =
    totalHours > 0 ? (billableHours / totalHours) * 100 : 0;
  const realizationPct = realization?.realization ?? null;

  // --- Chart 1: billable vs non-billable (donut) ---
  const splitData = useMemo(() => {
    if (totalHours <= 0) return [];
    return [
      {
        key: "billable",
        name: "Billable",
        value: Math.round(billableHours * 100) / 100,
        fill: COLOUR.emerald,
      },
      {
        key: "nonBillable",
        name: "Non-billable",
        value: Math.round(nonBillableHours * 100) / 100,
        fill: COLOUR.zinc,
      },
    ];
  }, [totalHours, billableHours, nonBillableHours]);

  // --- Chart 2: utilization by user (vertical bar, sorted desc) ---
  const userData = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.utilization - a.utilization)
        .map((r) => ({
          key: r.userId,
          name: r.name,
          utilization: r.utilization,
          billableHours: Math.round(r.billableHours * 100) / 100,
          totalHours: Math.round(r.totalHours * 100) / 100,
        })),
    [rows],
  );

  // --- Chart 3: hours by project (stacked billable/non-billable) ---
  // Derived from closed time entries (endedAt != null; skip running timers).
  const projectData = useMemo(() => {
    const byProject = new Map<
      string,
      { label: string; billable: number; nonBillable: number }
    >();
    for (const e of entries) {
      if (!e.endedAt) continue; // skip running entries
      const seconds = e.roundingAppliedSeconds ?? e.durationSeconds ?? 0;
      if (!seconds) continue;
      const hours = secondsToHours(seconds);
      const id = e.project?.id ?? "—";
      const label = e.project?.projectNumber ?? id.slice(0, 8);
      const cur = byProject.get(id) ?? { label, billable: 0, nonBillable: 0 };
      if (e.billable) cur.billable += hours;
      else cur.nonBillable += hours;
      byProject.set(id, cur);
    }
    return Array.from(byProject.values())
      .map((p) => ({
        name: p.label,
        billable: Math.round(p.billable * 100) / 100,
        nonBillable: Math.round(p.nonBillable * 100) / 100,
        total: Math.round((p.billable + p.nonBillable) * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [entries]);

  // --- WIP table (top projects by unbilled billable value) ---
  const wipRows = useMemo(
    () => [...(wip?.rows ?? [])].sort((a, b) => b.wipAmount - a.wipAmount).slice(0, 8),
    [wip],
  );

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="po-page-enter space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-9 w-80" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-16" />
                </div>
                <Skeleton className="h-10 w-10 rounded-lg" />
              </div>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[1, 2].map((i) => (
            <Card key={i} className="p-6 space-y-4">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-64 w-full" />
            </Card>
          ))}
        </div>
        <Card className="p-6 space-y-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-72 w-full" />
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------
  if (error) {
    return (
      <div className="po-page-enter space-y-6">
        <PeriodHeader period={period} onChange={setPeriod} />
        <Card className="p-6">
          <EmptyState
            icon={AlertTriangle}
            iconTone="rose"
            title="Couldn’t load utilization"
            body="Something went wrong fetching the time-tracking reports. Check your connection and try again."
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

  const hasAnyHours = totalHours > 0;
  const isStaff = user?.role === "STAFF";

  // -------------------------------------------------------------------------
  // Loaded
  // -------------------------------------------------------------------------
  return (
    <div className="po-page-enter space-y-6">
      <PeriodHeader period={period} onChange={setPeriod} />

      {/* Headline stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total hours"
          value={`${totalHours.toFixed(1)}h`}
          tone="blue"
          icon={Clock}
        />
        <StatCard
          label="Billable hours"
          value={`${billableHours.toFixed(1)}h`}
          tone="emerald"
          icon={CircleDollarSign}
        />
        <StatCard
          label="Overall utilization"
          value={`${overallUtilization.toFixed(1)}%`}
          tone="violet"
          icon={Gauge}
        />
        <StatCard
          label="Realization"
          value={realizationPct !== null ? `${realizationPct.toFixed(1)}%` : "—"}
          tone="amber"
          icon={Receipt}
        />
      </div>

      {/* Charts 1 + 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1 — billable vs non-billable */}
        <Card className="p-6">
          <ChartHeader
            icon={PieIcon}
            title="Billable vs non-billable"
            subtitle={
              hasAnyHours
                ? `${totalHours.toFixed(1)}h logged in this period`
                : "No hours logged in this period"
            }
          />
          <div className="h-64">
            {splitData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={splitData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="85%"
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {splitData.map((d) => (
                      <Cell key={d.key} fill={d.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [
                      `${Number(value).toFixed(1)}h`,
                      String(name),
                    ]}
                    contentStyle={TOOLTIP_STYLE}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={PieIcon}
                iconTone="zinc"
                title="No hours yet"
                body="Logged time will split into billable and non-billable here."
                className="h-full border-0"
              />
            )}
          </div>
          {splitData.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-xs">
              {splitData.map((d) => (
                <span key={d.key} className="inline-flex items-center gap-1.5">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: d.fill }}
                  />
                  <span className="text-muted-foreground">{d.name}</span>
                  <span className="font-mono tabular-nums font-medium text-foreground">
                    {d.value.toFixed(1)}h
                  </span>
                </span>
              ))}
            </div>
          )}
        </Card>

        {/* Chart 2 — utilization by user */}
        <Card className="p-6">
          <ChartHeader
            icon={BarChart3}
            title="Utilization by user"
            subtitle={
              isStaff
                ? "Your billable share of logged time"
                : `${userData.length} ${userData.length === 1 ? "person" : "people"} with logged time`
            }
          />
          <div className="h-64">
            {userData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={userData}
                  margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
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
                    domain={[0, 100]}
                    unit="%"
                    tickLine={false}
                    axisLine={false}
                    tick={AXIS_TICK}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-muted)" }}
                    formatter={(value, _name, item) => {
                      const p = item?.payload as
                        | { billableHours: number; totalHours: number }
                        | undefined;
                      const detail = p
                        ? ` (${p.billableHours.toFixed(1)}h of ${p.totalHours.toFixed(1)}h)`
                        : "";
                      return [`${Number(value).toFixed(1)}%${detail}`, "Utilization"];
                    }}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Bar
                    dataKey="utilization"
                    fill={COLOUR.violet}
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={BarChart3}
                iconTone="zinc"
                title="No utilization yet"
                body="Per-user utilization appears once time is logged in this period."
                className="h-full border-0"
              />
            )}
          </div>
        </Card>
      </div>

      {/* Chart 3 — hours by project (stacked) */}
      <Card className="p-6">
        <ChartHeader
          icon={FolderKanban}
          title="Hours by project"
          subtitle={
            projectData.length > 0
              ? `Billable vs non-billable across ${projectData.length} ${projectData.length === 1 ? "project" : "projects"}`
              : "No completed time entries in this period"
          }
        />
        <div className="h-72">
          {projectData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={projectData}
                margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
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
                    name === "billable" ? "Billable" : "Non-billable",
                  ]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar
                  dataKey="billable"
                  stackId="hours"
                  fill={COLOUR.emerald}
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="nonBillable"
                  stackId="hours"
                  fill={COLOUR.zinc}
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={FolderKanban}
              iconTone="zinc"
              title="No project hours yet"
              body="Completed time entries grouped by project will appear here."
              className="h-full border-0"
            />
          )}
        </div>
        {projectData.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-xs">
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: COLOUR.emerald }}
              />
              <span className="text-muted-foreground">Billable</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: COLOUR.zinc }}
              />
              <span className="text-muted-foreground">Non-billable</span>
            </span>
          </div>
        )}
      </Card>

      {/* WIP table — unbilled approved billable value by project */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
              Work in progress
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {wip && wip.rows.length > 0
                ? `${formatMoney(wip.totalWip)} of approved, unbilled billable value`
                : "Approved, billable, not-yet-invoiced value by project"}
            </p>
          </div>
        </div>
        {wipRows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="text-left font-medium py-2 pr-4">Project</th>
                  <th className="text-right font-medium py-2 px-4">Hours</th>
                  <th className="text-right font-medium py-2 pl-4">Unbilled value</th>
                </tr>
              </thead>
              <tbody>
                {wipRows.map((r) => (
                  <tr
                    key={r.projectId}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="py-2.5 pr-4">
                      <span className="font-medium text-foreground">
                        {r.project?.projectNumber ?? r.projectId.slice(0, 8)}
                      </span>
                      {r.project?.title && (
                        <span className="text-muted-foreground">
                          {" "}
                          — {r.project.title}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
                      {secondsToHours(r.wipHours * 3600).toFixed(1)}h
                    </td>
                    <td className="py-2.5 pl-4 text-right font-mono tabular-nums text-foreground">
                      {formatMoney(r.wipAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={CircleDollarSign}
            iconTone="emerald"
            title="Nothing unbilled"
            body="Approved billable time that hasn’t been invoiced yet will show up here, grouped by project."
          />
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PeriodHeader({
  period,
  onChange,
}: {
  period: PeriodKey;
  onChange: (p: PeriodKey) => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Billable utilization, realization, and work in progress across your time
        entries.
      </p>
      {/* Segmented control */}
      <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            aria-pressed={period === opt.key}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              period === opt.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: Parameters<typeof iconWellClass>[0];
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-1 font-mono tabular-nums">
            {value}
          </p>
        </div>
        <div
          className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconWellClass(tone)}`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function ChartHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}
