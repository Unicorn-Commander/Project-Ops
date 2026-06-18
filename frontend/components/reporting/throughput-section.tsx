"use client";

/**
 * Throughput report — delivery velocity over a date range.
 *
 *   - A date-range control.
 *   - Headline tiles: tasks completed, projects completed.
 *   - Completed-tasks-over-time area chart (the `series`).
 *   - Tasks-by-status bar.
 *   - Projects-completed-over-time area chart (the `series`).
 *
 * Read-only; no money involved, so no visibility gating here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AreaChart,
  Area,
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
  getThroughputReport,
  type ThroughputReport,
  type SeriesPoint,
} from "@/lib/reporting-api";
import {
  COLOUR,
  STATUS_COLOUR,
  statusLabel,
  colourForIndex,
  TOOLTIP_STYLE,
  AXIS_TICK,
  StatCard,
  ChartHeader,
  DateRangeControl,
  resolveRange,
  type RangeKey,
} from "./shared";
import {
  CheckCircle2,
  FolderCheck,
  LineChart as LineIcon,
  BarChart3,
  Activity,
  AlertTriangle,
} from "lucide-react";

export function ThroughputSection() {
  const { toast } = useToast();
  const [range, setRange] = useState<RangeKey>("last12m");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [report, setReport] = useState<ThroughputReport | null>(null);

  const fetchData = useCallback(async (key: RangeKey) => {
    setLoading(true);
    setError(false);
    // resolveRange() reads new Date() — safe here (effect/handler, not render).
    const { from, to } = resolveRange(key);
    try {
      setReport(await getThroughputReport({ from, to }));
    } catch (err) {
      console.error("Error loading throughput report:", err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(range);
  }, [fetchData, range]);

  const handleRetry = () => {
    toast({ title: "Retrying", description: "Reloading throughput…" });
    fetchData(range);
  };

  const taskSeries = useMemo<SeriesPoint[]>(
    () => report?.tasksCompleted.series ?? [],
    [report],
  );
  const projectSeries = useMemo<SeriesPoint[]>(
    () => report?.projectsCompleted.series ?? [],
    [report],
  );
  const statusData = useMemo(() => {
    return (report?.tasksByStatus ?? [])
      .filter((s) => s.value > 0)
      .map((s, i) => ({
        key: s.label,
        name: statusLabel(s.label),
        value: s.value,
        fill: STATUS_COLOUR[s.label] ?? colourForIndex(i),
      }));
  }, [report]);

  if (loading) return <ThroughputSkeleton range={range} onChange={setRange} />;

  if (error) {
    return (
      <div className="space-y-6">
        <Header range={range} onChange={setRange} />
        <Card className="p-6">
          <EmptyState
            icon={AlertTriangle}
            iconTone="rose"
            title="Couldn’t load throughput"
            body="Something went wrong fetching the throughput report. Check your connection and try again."
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

  return (
    <div className="space-y-6">
      <Header range={range} onChange={setRange} />

      {/* Headline tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          label="Tasks completed"
          value={String(report?.tasksCompleted.total ?? 0)}
          sub="In selected period"
          tone="emerald"
          icon={CheckCircle2}
        />
        <StatCard
          label="Projects completed"
          value={String(report?.projectsCompleted.total ?? 0)}
          sub="In selected period"
          tone="blue"
          icon={FolderCheck}
        />
      </div>

      {/* Completed tasks over time */}
      <Card className="p-6">
        <ChartHeader
          icon={LineIcon}
          title="Tasks completed over time"
          subtitle={
            taskSeries.length > 0
              ? `${report?.tasksCompleted.total ?? 0} task${report?.tasksCompleted.total === 1 ? "" : "s"} completed across ${taskSeries.length} period${taskSeries.length === 1 ? "" : "s"}`
              : "No tasks completed in this period"
          }
        />
        <div className="h-72">
          {taskSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={288}>
              <AreaChart
                data={taskSeries}
                margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              >
                <defs>
                  <linearGradient id="throughputTasks" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOUR.emerald} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLOUR.emerald} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--color-border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                />
                <Tooltip
                  cursor={{ stroke: "var(--color-border)" }}
                  formatter={(value) => [String(value), "Tasks"]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={COLOUR.emerald}
                  strokeWidth={2}
                  fill="url(#throughputTasks)"
                  isAnimationActive={false}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={LineIcon}
              iconTone="zinc"
              title="No completed tasks yet"
              body="Completed tasks will plot over time here once work is finished in this period."
              className="h-full border-0"
            />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks by status */}
        <Card className="p-6">
          <ChartHeader
            icon={BarChart3}
            title="Tasks by status"
            subtitle={
              statusData.length > 0
                ? `Where tasks sit across ${statusData.length} status${statusData.length === 1 ? "" : "es"}`
                : "No tasks in this period"
            }
          />
          <div className="h-64">
            {statusData.length > 0 ? (
              <ResponsiveContainer width="100%" height={256}>
                <BarChart
                  data={statusData}
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
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={AXIS_TICK}
                  />
                  <Tooltip
                    cursor={{ fill: "var(--color-muted)" }}
                    formatter={(value, _name, item) => [
                      String(value),
                      (item?.payload as { name: string })?.name ?? "Tasks",
                    ]}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                    {statusData.map((d) => (
                      <Cell key={d.key} fill={d.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={BarChart3}
                iconTone="zinc"
                title="No tasks yet"
                body="Task status distribution will appear here."
                className="h-full border-0"
              />
            )}
          </div>
        </Card>

        {/* Projects completed over time */}
        <Card className="p-6">
          <ChartHeader
            icon={Activity}
            title="Projects completed over time"
            subtitle={
              projectSeries.length > 0
                ? `${report?.projectsCompleted.total ?? 0} project${report?.projectsCompleted.total === 1 ? "" : "s"} completed`
                : "No projects completed in this period"
            }
          />
          <div className="h-64">
            {projectSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={256}>
                <AreaChart
                  data={projectSeries}
                  margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
                >
                  <defs>
                    <linearGradient id="throughputProjects" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLOUR.blue} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={COLOUR.blue} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={AXIS_TICK}
                    minTickGap={16}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tick={AXIS_TICK}
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--color-border)" }}
                    formatter={(value) => [String(value), "Projects"]}
                    contentStyle={TOOLTIP_STYLE}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke={COLOUR.blue}
                    strokeWidth={2}
                    fill="url(#throughputProjects)"
                    isAnimationActive={false}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={Activity}
                iconTone="zinc"
                title="No completed projects yet"
                body="Completed projects will plot over time here."
                className="h-full border-0"
              />
            )}
          </div>
        </Card>
      </div>
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
        Completed tasks and projects over time, and where work currently sits.
      </p>
      <DateRangeControl value={range} onChange={onChange} />
    </div>
  );
}

function ThroughputSkeleton({
  range,
  onChange,
}: {
  range: RangeKey;
  onChange: (k: RangeKey) => void;
}) {
  return (
    <div className="space-y-6">
      <Header range={range} onChange={onChange} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2].map((i) => (
          <Card key={i} className="p-4">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-7 w-16" />
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <Card key={i} className="p-6 space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-64 w-full" />
          </Card>
        ))}
      </div>
    </div>
  );
}
