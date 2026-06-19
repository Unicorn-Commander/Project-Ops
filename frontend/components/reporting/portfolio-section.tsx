"use client";

/**
 * Portfolio report — the at-a-glance health of every project in the workspace.
 *
 *   - KPI tiles: active projects, budget-vs-logged hours, billed-vs-budget.
 *   - A status-breakdown donut.
 *   - A sortable project-health table with budget/logged bars, % complete,
 *     and over-budget rows flagged red.
 *
 * Read-only; visibility-scoped server-side. Money fields can be null for
 * non-privileged callers — every money cell tolerates that.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpHint } from "@/components/guidance";
import { useToast } from "@/components/ui/use-toast";
import { statusBadgeClass } from "@/lib/badge-styles";
import {
  getPortfolioReport,
  formatHours,
  formatMoney,
  type PortfolioReport,
  type PortfolioProject,
} from "@/lib/reporting-api";
import {
  COLOUR,
  STATUS_COLOUR,
  statusLabel,
  TOOLTIP_STYLE,
  StatCard,
  ChartHeader,
  ChartLegend,
  ChartFigure,
} from "./shared";
import {
  FolderKanban,
  Clock,
  CircleDollarSign,
  PieChart as PieIcon,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ListChecks,
} from "lucide-react";

type SortKey =
  | "projectNumber"
  | "clientName"
  | "status"
  | "loggedHours"
  | "pctHours"
  | "billedAmount"
  | "percentComplete";

type SortDir = "asc" | "desc";

// A thin budget/logged bar used inside the health table.
function MeterBar({
  pct,
  over,
}: {
  pct: number | null;
  over: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, pct ?? 0));
  const fill = over ? COLOUR.rose : clamped >= 90 ? COLOUR.amber : COLOUR.emerald;
  const meterLabel =
    pct === null
      ? "No budget set"
      : `${pct.toFixed(0)}% of budget used${
          over ? " — over budget" : clamped >= 90 ? " — near budget" : ""
        }`;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-20 overflow-hidden rounded-full bg-foreground/[0.08]"
        role="img"
        aria-label={meterLabel}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${clamped}%`, background: fill }}
        />
      </div>
      <span className="font-mono tabular-nums text-xs text-muted-foreground w-10 text-right">
        {pct === null ? "—" : `${pct.toFixed(0)}%`}
      </span>
    </div>
  );
}

export function PortfolioSection() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [report, setReport] = useState<PortfolioReport | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("pctHours");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setReport(await getPortfolioReport());
    } catch (err) {
      console.error("Error loading portfolio report:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRetry = () => {
    toast({ title: "Retrying", description: "Reloading portfolio…" });
    fetchData();
  };

  const totals = report?.totals;

  // Status donut data.
  const donutData = useMemo(() => {
    return (report?.statusBreakdown ?? [])
      .filter((s) => s.value > 0)
      .map((s) => ({
        key: s.label,
        name: statusLabel(s.label),
        value: s.value,
        fill: STATUS_COLOUR[s.label] ?? COLOUR.zinc,
      }));
  }, [report]);

  // Sorted table rows.
  const sortedProjects = useMemo(() => {
    const rows = [...(report?.projects ?? [])];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // null/undefined always sort to the bottom regardless of direction.
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      return ((av as number) - (bv as number)) * dir;
    });
    return rows;
  }, [report, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Text columns default to A→Z; numeric columns default to high→low.
      setSortDir(key === "projectNumber" || key === "clientName" || key === "status" ? "asc" : "desc");
    }
  };

  if (loading) return <PortfolioSkeleton />;

  if (error) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={AlertTriangle}
          iconTone="rose"
          title="Couldn’t load the portfolio"
          body="Something went wrong fetching the portfolio report. Check your connection and try again."
          action={
            <Button onClick={handleRetry} variant="outline">
              Try again
            </Button>
          }
        />
      </Card>
    );
  }

  const projects = report?.projects ?? [];
  const hasProjects = projects.length > 0;

  return (
    <div className="space-y-6">
      {/* KPI tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active projects"
          value={String(totals?.activeProjects ?? 0)}
          sub={`${totals?.projects ?? 0} total in workspace`}
          tone="blue"
          icon={FolderKanban}
        />
        <StatCard
          label="Logged vs budget"
          value={formatHours(totals?.loggedHours)}
          sub={`of ${formatHours(totals?.budgetHours)} budgeted`}
          tone="violet"
          icon={Clock}
        />
        <StatCard
          label="Billed vs budget"
          value={formatMoney(totals?.billedAmount)}
          sub={`of ${formatMoney(totals?.budgetAmount)} budgeted`}
          tone="emerald"
          icon={CircleDollarSign}
        />
        <StatCard
          label="Tasks completed"
          value={String(totals?.tasksCompleted ?? 0)}
          sub={`of ${totals?.tasksTotal ?? 0} tasks`}
          tone="amber"
          icon={ListChecks}
        />
      </div>

      {/* Status donut + summary */}
      <Card className="p-6">
        <ChartHeader
          icon={PieIcon}
          title="Projects by status"
          subtitle={
            hasProjects
              ? `${projects.length} project${projects.length === 1 ? "" : "s"} across ${donutData.length} status${donutData.length === 1 ? "" : "es"}`
              : "No projects in this workspace yet"
          }
        />
        {donutData.length > 0 ? (
          <ChartFigure
            heightClass="h-64"
            summary={`Projects by status: ${donutData
              .map((d) => `${d.name} ${d.value}`)
              .join(", ")}.`}
          >
            <ResponsiveContainer width="100%" height={256}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={64}
                  outerRadius={100}
                  paddingAngle={2}
                  strokeWidth={0}
                  isAnimationActive={false}
                >
                  {donutData.map((d) => (
                    <Cell key={d.key} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [String(value), String(name)]}
                  contentStyle={TOOLTIP_STYLE}
                />
              </PieChart>
            </ResponsiveContainer>
          </ChartFigure>
        ) : (
          <div className="h-64">
            <EmptyState
              icon={PieIcon}
              iconTone="zinc"
              title="No projects yet"
              body="Project status distribution will appear here once you have projects."
              className="h-full border-0"
            />
          </div>
        )}
        <ChartLegend
          items={donutData.map((d) => ({
            key: d.key,
            label: d.name,
            value: String(d.value),
            fill: d.fill,
          }))}
        />
      </Card>

      {/* Project health table */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              Project health
              <HelpHint
                learnMore={{ category: "reports", article: "reports-overview" }}
              >
                Budget burn, billing, and completion per project. The hours bar shows logged
                against budgeted; a project that&apos;s logged more hours than budgeted is
                flagged <span className="font-semibold text-rose-600 dark:text-rose-400">Over
                budget</span> with a red row. Click any column to sort.
              </HelpHint>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Budget burn, billing, and completion across every project. Click a
              column to sort.
            </p>
          </div>
        </div>
        {hasProjects ? (
          <div className="-mx-6 overflow-x-auto px-6">
            <table className="w-full min-w-[40rem] text-sm">
              <caption className="sr-only">
                Project health: budget burn, billing, and completion per
                project. Use the column header buttons to sort.
              </caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <SortableTh
                    label="Project"
                    col="projectNumber"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="left"
                    className="sticky left-0 z-10 bg-card pl-3"
                  />
                  <SortableTh
                    label="Client"
                    col="clientName"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="left"
                  />
                  <SortableTh
                    label="Status"
                    col="status"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="left"
                  />
                  <SortableTh
                    label="Hours (logged/budget)"
                    col="pctHours"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="left"
                  />
                  <SortableTh
                    label="Billed"
                    col="billedAmount"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableTh
                    label="Complete"
                    col="percentComplete"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {sortedProjects.map((p) => (
                  <ProjectRow key={p.projectId} p={p} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={FolderKanban}
            iconTone="zinc"
            title="No projects yet"
            body="Create a project to start tracking budget, billing, and completion here."
          />
        )}
      </Card>
    </div>
  );
}

function ProjectRow({ p }: { p: PortfolioProject }) {
  return (
    <tr
      className={`border-b border-border/60 last:border-0 ${
        p.overBudget
          ? "bg-rose-500/[0.05] shadow-[inset_3px_0_0_0] shadow-rose-500/70 dark:shadow-rose-400/70"
          : ""
      }`}
    >
      <th
        scope="row"
        className={`sticky left-0 z-10 py-2.5 pl-3 pr-4 text-left font-normal ${
          p.overBudget ? "bg-rose-50 dark:bg-rose-950/40" : "bg-card"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-foreground">{p.projectNumber}</span>
          {p.overBudget && (
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-2.5 w-2.5" />
              Over budget
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground line-clamp-1">
          {p.title}
        </span>
      </th>
      <td className="py-2.5 px-4 text-muted-foreground/80">
        {p.clientName ?? <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="py-2.5 px-4">
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(p.status)}`}
        >
          {statusLabel(p.status)}
        </span>
      </td>
      <td className="py-2.5 px-4">
        <MeterBar pct={p.pctHours} over={p.overBudget} />
        <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
          {formatHours(p.loggedHours)} / {formatHours(p.budgetHours)}
        </span>
      </td>
      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-foreground">
        {formatMoney(p.billedAmount)}
      </td>
      <td className="py-2.5 pl-4 text-right">
        <span className="font-mono tabular-nums text-foreground">
          {p.percentComplete.toFixed(0)}%
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {p.tasksCompleted}/{p.tasksTotal} tasks
        </span>
      </td>
    </tr>
  );
}

function SortableTh({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align,
  className,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align: "left" | "right";
  className?: string;
}) {
  const active = sortKey === col;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`font-medium py-2 ${align === "right" ? "text-right pl-4" : "text-left pr-4"} ${className ?? ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(col)}
        aria-label={`Sort by ${label}${
          active ? (sortDir === "asc" ? ", ascending" : ", descending") : ""
        }`}
        className={`inline-flex items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          active ? "text-foreground" : ""
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <Icon className="h-3 w-3 opacity-60" aria-hidden />
      </button>
    </th>
  );
}

function PortfolioSkeleton() {
  return (
    <div className="space-y-6">
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
      <Card className="p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-64 w-full" />
      </Card>
      <Card className="p-6 space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-72 w-full" />
      </Card>
    </div>
  );
}
