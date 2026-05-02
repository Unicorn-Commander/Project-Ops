"use client";

/**
 * Per-project snapshot — completion progress bar + task status donut +
 * task priority bar. Sits at the top of the project detail page so the
 * shape of the project's work is visible at a glance before scrolling
 * into the task list. Reuses the colour vocabulary + tooltip styling
 * from `components/dashboard/project-charts.tsx` so the dashboard and
 * detail page look like one product.
 *
 * Designed to fail soft: when the project has no tasks we render a
 * single info card instead of a broken/empty SVG.
 */

import { useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Card } from "@/components/ui/card";
import { CheckCircle2, ListTodo, AlertOctagon } from "lucide-react";
import type { Task } from "@/lib/tasks-api";

const STATUS_COLOURS: Record<string, string> = {
  PENDING:             "#3b82f6", // blue-500
  IN_PROGRESS:         "#f59e0b", // amber-500
  WAITING_FOR_CLIENT:  "#8b5cf6", // violet-500
  COMPLETED:           "#10b981", // emerald-500
  CANCELLED:           "#71717a", // zinc-500
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:             "Pending",
  IN_PROGRESS:         "In progress",
  WAITING_FOR_CLIENT:  "Waiting for client",
  COMPLETED:           "Completed",
  CANCELLED:           "Cancelled",
};

const PRIORITY_COLOURS: Record<string, string> = {
  LOW:    "#10b981", // emerald-500
  MEDIUM: "#f59e0b", // amber-500
  HIGH:   "#f97316", // orange-500
  URGENT: "#e11d48", // rose-600
};

const PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

interface ProjectSnapshotProps {
  tasks: Task[];
}

export function ProjectSnapshot({ tasks }: ProjectSnapshotProps) {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const overdue = tasks.filter((t) => {
    if (!t.dueDate || t.status === "COMPLETED" || t.status === "CANCELLED") return false;
    return new Date(t.dueDate) < new Date();
  }).length;
  const completionPct = total === 0 ? 0 : Math.round((completed / total) * 100);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach((t) => {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABEL[status] ?? status,
      key: status,
      value,
      fill: STATUS_COLOURS[status] ?? "#71717a",
    }));
  }, [tasks]);

  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach((t) => {
      counts[t.priority] = (counts[t.priority] ?? 0) + 1;
    });
    return PRIORITY_ORDER.filter((k) => counts[k] != null).map((k) => ({
      name: k.charAt(0) + k.slice(1).toLowerCase(),
      key: k,
      value: counts[k] ?? 0,
      fill: PRIORITY_COLOURS[k] ?? "#71717a",
    }));
  }, [tasks]);

  // No tasks: show a single helpful card instead of empty charts.
  if (total === 0) {
    return (
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <ListTodo className="h-5 w-5" />
          <p className="text-sm">
            No tasks for this project yet. Add a task below to start
            tracking progress.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 mb-6">
      {/* Top row: three quick stats + progress bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-300">
            <ListTodo className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Total tasks</p>
            <p className="text-2xl font-bold leading-tight">{total}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
            <CheckCircle2 className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Completed</p>
            <p className="text-2xl font-bold leading-tight">{completed}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${overdue > 0 ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"}`}>
            <AlertOctagon className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Overdue</p>
            <p className={`text-2xl font-bold leading-tight ${overdue > 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>{overdue}</p>
          </div>
        </div>
      </div>

      {/* Progress bar — straightforward % strip with completion label. */}
      <div className="mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm font-medium text-foreground">Completion</span>
          <span className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{completionPct}%</span> · {completed} of {total} done
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full bg-emerald-500 dark:bg-emerald-400 transition-all duration-300"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </div>

      {/* Charts — status donut + priority bar. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Status</h4>
          <div className="h-44">
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
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
            {statusData.map((d) => (
              <span key={d.key} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: d.fill }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="font-mono font-medium text-foreground">{d.value}</span>
              </span>
            ))}
          </div>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Priority</h4>
          <div className="h-44">
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
        </div>
      </div>
    </Card>
  );
}
