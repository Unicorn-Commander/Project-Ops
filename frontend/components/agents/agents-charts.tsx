"use client";

import { useMemo } from "react";
import type { ComponentType } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CircleDollarSign, LineChart } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type {
  AgentUsageByAgent,
  AgentUsageSeriesPoint,
} from "@/lib/agents-api";
import { formatCost, formatInt } from "./agent-format";

const COLOUR = {
  blue: "#3b82f6",
  violet: "#8b5cf6",
  emerald: "#10b981",
  amber: "#f59e0b",
  zinc: "#71717a",
} as const;

const TOOLTIP_STYLE = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  color: "var(--color-popover-foreground)",
  fontSize: "12px",
} as const;

const AXIS_TICK = { fill: "var(--color-muted-foreground)", fontSize: 12 } as const;

interface UsageChartsProps {
  series: AgentUsageSeriesPoint[];
  byAgent: AgentUsageByAgent[];
}

export function AgentsUsageCharts({ series, byAgent }: UsageChartsProps) {
  const agentBreakdown = useMemo(
    () =>
      [...byAgent]
        .sort((a, b) => b.costUsd - a.costUsd || b.eventCount - a.eventCount)
        .slice(0, 10)
        .map((agent) => ({
          name: agent.actorLabel,
          events: agent.eventCount,
          cost: agent.costUsd,
        })),
    [byAgent],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <TimeSeriesCard
        title="Agent events over time"
        subtitle={
          series.length > 0
            ? `${series.length} ${series.length === 1 ? "bucket" : "buckets"} in this window`
            : "No agent events in this window"
        }
        icon={LineChart}
        dataKey="eventCount"
        colour={COLOUR.blue}
        formatter={(value) => formatInt(Number(value))}
        label="Events"
        series={series}
      />
      <TimeSeriesCard
        title="Cost over time"
        subtitle="LLM-backed activity only; zero-cost tool calls still count as work"
        icon={CircleDollarSign}
        dataKey="costUsd"
        colour={COLOUR.emerald}
        formatter={(value) => formatCost(Number(value))}
        label="Cost"
        series={series}
      />
      <Card className="p-6 lg:col-span-2">
        <ChartHeader
          icon={BarChart3}
          title="Per-agent breakdown"
          subtitle={
            agentBreakdown.length > 0
              ? "Events and cost by the most active agents"
              : "No per-agent usage to chart"
          }
        />
        <div className="h-72">
          {agentBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={288}>
              <BarChart
                data={agentBreakdown}
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
                  yAxisId="events"
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tick={AXIS_TICK}
                />
                <YAxis
                  yAxisId="cost"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tick={AXIS_TICK}
                  tickFormatter={(value) => formatCost(Number(value))}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  formatter={(value, name) => [
                    name === "cost" ? formatCost(Number(value)) : formatInt(Number(value)),
                    name === "cost" ? "Cost" : "Events",
                  ]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar
                  yAxisId="events"
                  dataKey="events"
                  fill={COLOUR.blue}
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
                <Bar
                  yAxisId="cost"
                  dataKey="cost"
                  fill={COLOUR.emerald}
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                >
                  {agentBreakdown.map((row) => (
                    <Cell key={row.name} fill={COLOUR.emerald} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={BarChart3}
              iconTone="zinc"
              title="No usage yet"
              body="Agent cost and event volume will appear here once activity is recorded."
              className="h-full border-0"
            />
          )}
        </div>
      </Card>
    </div>
  );
}

interface DetailChartsProps {
  series: AgentUsageSeriesPoint[];
  byProject: { projectId: string; projectName: string; eventCount: number; costUsd: number }[];
}

export function AgentDetailCharts({ series, byProject }: DetailChartsProps) {
  const projects = useMemo(
    () =>
      [...byProject]
        .sort((a, b) => b.eventCount - a.eventCount)
        .slice(0, 10)
        .map((project) => ({
          name: project.projectName,
          events: project.eventCount,
          cost: project.costUsd,
        })),
    [byProject],
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <TimeSeriesCard
        title="Usage over time"
        subtitle="Events and cost for this agent"
        icon={LineChart}
        dataKey="eventCount"
        colour={COLOUR.violet}
        formatter={(value) => formatInt(Number(value))}
        label="Events"
        series={series}
      />
      <Card className="p-6">
        <ChartHeader
          icon={BarChart3}
          title="Projects touched"
          subtitle={
            projects.length > 0
              ? `${projects.length} ${projects.length === 1 ? "project" : "projects"} in this window`
              : "No project activity in this window"
          }
        />
        <div className="h-64">
          {projects.length > 0 ? (
            <ResponsiveContainer width="100%" height={256}>
              <BarChart data={projects} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
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
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  tick={AXIS_TICK}
                />
                <Tooltip
                  cursor={{ fill: "var(--color-muted)" }}
                  formatter={(value, name) => [
                    name === "cost" ? formatCost(Number(value)) : formatInt(Number(value)),
                    name === "cost" ? "Cost" : "Events",
                  ]}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar
                  dataKey="events"
                  fill={COLOUR.violet}
                  radius={[6, 6, 0, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={BarChart3}
              iconTone="zinc"
              title="No project activity"
              body="Project-level agent work appears here when events include a project."
              className="h-full border-0"
            />
          )}
        </div>
      </Card>
    </div>
  );
}

interface TimeSeriesCardProps {
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  series: AgentUsageSeriesPoint[];
  dataKey: "eventCount" | "costUsd";
  label: string;
  colour: string;
  formatter: (value: number) => string;
}

function TimeSeriesCard({
  title,
  subtitle,
  icon,
  series,
  dataKey,
  label,
  colour,
  formatter,
}: TimeSeriesCardProps) {
  const Icon = icon;
  return (
    <Card className="p-6">
      <ChartHeader icon={Icon} title={title} subtitle={subtitle} />
      <div className="h-64">
        {series.length > 0 ? (
          <ResponsiveContainer width="100%" height={256}>
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <defs>
                <linearGradient id={`${dataKey}-agent-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colour} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={colour} stopOpacity={0.03} />
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
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                allowDecimals={dataKey !== "eventCount"}
                tick={AXIS_TICK}
                tickFormatter={(value) =>
                  dataKey === "costUsd" ? formatCost(Number(value)) : formatInt(Number(value))
                }
              />
              <Tooltip
                cursor={{ stroke: "var(--color-border)" }}
                formatter={(value) => [formatter(Number(value)), label]}
                contentStyle={TOOLTIP_STYLE}
              />
              <Area
                type="monotone"
                dataKey={dataKey}
                stroke={colour}
                fill={`url(#${dataKey}-agent-fill)`}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyState
            icon={Icon}
            iconTone="zinc"
            title="No data yet"
            body="Agent activity in this date range will appear here."
            className="h-full border-0"
          />
        )}
      </div>
    </Card>
  );
}

function ChartHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}
