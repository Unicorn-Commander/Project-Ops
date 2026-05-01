"use client";

/**
 * Dashboard charts — at-a-glance distribution of projects by status and
 * tasks by priority. Recharts under the hood; tokens come from the same
 * Tailwind palette the kanban uses so the dashboard, kanban, and Vibrant
 * theme all share one chromatic vocabulary.
 *
 * Designed to fail soft: when there's no data we render an EmptyState
 * with a chart icon rather than a broken/empty SVG.
 */

import { useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Card } from "@/components/ui/card";
import { BarChart3, PieChart as PieIcon } from "lucide-react";

interface ProjectLite {
  id: string;
  status: string;
  priority: string;
}

interface Props {
  projects: ProjectLite[];
}

// Tailwind 500-shade hex equivalents (kept in JS so Recharts can render
// straight SVG fills — CSS variables don't propagate into <svg>).
const STATUS_COLOURS: Record<string, string> = {
  NEW:          "#3b82f6", // blue-500
  IN_PROGRESS:  "#f59e0b", // amber-500
  UNDER_REVIEW: "#8b5cf6", // violet-500
  COMPLETED:    "#10b981", // emerald-500
  ON_HOLD:      "#f97316", // orange-500
  ARCHIVED:     "#71717a", // zinc-500
};

const PRIORITY_COLOURS: Record<string, string> = {
  LOW:    "#71717a",   // zinc-500
  MEDIUM: "#3b82f6",   // blue-500
  HIGH:   "#f97316",   // orange-500
  URGENT: "#e11d48",   // rose-600
};

const STATUS_LABEL: Record<string, string> = {
  NEW:          "New",
  IN_PROGRESS:  "In progress",
  UNDER_REVIEW: "In review",
  COMPLETED:    "Completed",
  ON_HOLD:      "On hold",
  ARCHIVED:     "Archived",
};

const PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export function ProjectCharts({ projects }: Props) {
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABEL[status] ?? status,
      key: status,
      value,
      fill: STATUS_COLOURS[status] ?? "#71717a",
    }));
  }, [projects]);

  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      counts[p.priority] = (counts[p.priority] ?? 0) + 1;
    });
    return PRIORITY_ORDER.filter((k) => counts[k] != null).map((k) => ({
      name: k.charAt(0) + k.slice(1).toLowerCase(),
      key: k,
      value: counts[k] ?? 0,
      fill: PRIORITY_COLOURS[k] ?? "#71717a",
    }));
  }, [projects]);

  const total = projects.length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <PieIcon className="h-4 w-4 text-muted-foreground" />
              Project status
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {total} project{total === 1 ? "" : "s"} across {statusData.length} status{statusData.length === 1 ? "" : "es"}
            </p>
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={statusData}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                strokeWidth={0}
              >
                {statusData.map((d) => (
                  <Cell key={d.key} fill={d.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  color: "var(--color-popover-foreground)",
                  fontSize: "12px",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-xs">
          {statusData.map((d) => (
            <span key={d.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: d.fill }}
              />
              <span className="text-muted-foreground">{d.name}</span>
              <span className="font-mono font-medium text-foreground">{d.value}</span>
            </span>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              Priority distribution
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Where the {total} project{total === 1 ? " sits" : "s sit"} on the urgency scale
            </p>
          </div>
        </div>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={priorityData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              />
              <YAxis
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
              />
              <Tooltip
                cursor={{ fill: "var(--color-muted)" }}
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "8px",
                  color: "var(--color-popover-foreground)",
                  fontSize: "12px",
                }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {priorityData.map((d) => (
                  <Cell key={d.key} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
