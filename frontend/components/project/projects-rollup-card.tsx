"use client";

/**
 * Rollup snapshot of a list of projects — used by the organisation and
 * contact detail pages to summarise their project portfolio at a
 * glance. Mirrors the per-project `<ProjectSnapshot>` (which summarises
 * tasks) so the dashboard, project detail, and CRM detail pages all
 * share one chromatic + structural vocabulary.
 *
 * Stats: Active count, Completed count, Total billed, Outstanding.
 * Charts: project-status donut + project-priority bar.
 *
 * Empty state: helpful card when there are no projects yet rather
 * than an empty SVG.
 */

import { useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { Card } from "@/components/ui/card";
import {
  Briefcase, CheckCircle2, DollarSign, AlertOctagon,
} from "lucide-react";

interface ProjectLite {
  id: string;
  status: string;
  priority: string;
  billingAmount?: number | null;
  amountPaid?: number | null;
}

const STATUS_COLOURS: Record<string, string> = {
  NEW:          "#3b82f6",
  IN_PROGRESS:  "#f59e0b",
  UNDER_REVIEW: "#8b5cf6",
  COMPLETED:    "#10b981",
  ON_HOLD:      "#71717a",
  CANCELLED:    "#e11d48",
  ARCHIVED:     "#71717a",
};
const STATUS_LABEL: Record<string, string> = {
  NEW:          "New",
  IN_PROGRESS:  "In progress",
  UNDER_REVIEW: "In review",
  COMPLETED:    "Completed",
  ON_HOLD:      "On hold",
  CANCELLED:    "Cancelled",
  ARCHIVED:     "Archived",
};
const PRIORITY_COLOURS: Record<string, string> = {
  LOW:    "#10b981",
  MEDIUM: "#f59e0b",
  HIGH:   "#f97316",
  URGENT: "#e11d48",
};
const PRIORITY_ORDER = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const ACTIVE_STATUSES = new Set(["NEW", "IN_PROGRESS", "UNDER_REVIEW", "ON_HOLD"]);

function fmtUsd(n: number): string {
  if (Number.isNaN(n)) return "$0";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

interface ProjectsRollupCardProps {
  projects: ProjectLite[];
  /** Override the empty-state copy (e.g. "No projects with this contact yet"). */
  emptyMessage?: string;
}

export function ProjectsRollupCard({ projects, emptyMessage }: ProjectsRollupCardProps) {
  const total = projects.length;
  const active = projects.filter((p) => ACTIVE_STATUSES.has(p.status)).length;
  const completed = projects.filter((p) => p.status === "COMPLETED").length;
  const totalBilled = projects.reduce((s, p) => s + Number(p.billingAmount ?? 0), 0);
  const totalPaid = projects.reduce((s, p) => s + Number(p.amountPaid ?? 0), 0);
  const outstanding = Math.max(totalBilled - totalPaid, 0);

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

  if (total === 0) {
    return (
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-3 text-muted-foreground">
          <Briefcase className="h-5 w-5" />
          <p className="text-sm">{emptyMessage ?? "No projects yet."}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6 mb-6">
      {/* Top row: 4 quick stats. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/15 text-blue-600 dark:text-blue-300">
            <Briefcase className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Active</p>
            <p className="text-2xl font-bold leading-tight">{active}</p>
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
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-300">
            <DollarSign className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Billed</p>
            <p className="text-xl font-bold leading-tight">{fmtUsd(totalBilled)}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className={`inline-flex h-10 w-10 items-center justify-center rounded-md ${outstanding > 0 ? "bg-amber-500/15 text-amber-600 dark:text-amber-300" : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300"}`}>
            <AlertOctagon className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Outstanding</p>
            <p className={`text-xl font-bold leading-tight ${outstanding > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>
              {fmtUsd(outstanding)}
            </p>
          </div>
        </div>
      </div>

      {/* Charts — status donut + priority bar. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold text-foreground mb-2">Project status</h4>
          <div className="h-44">
            <ResponsiveContainer width="100%" height={176}>
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
                  {statusData.map((d) => <Cell key={d.key} fill={d.fill} />)}
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
            <ResponsiveContainer width="100%" height={176}>
              <BarChart data={priorityData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }} />
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
                  {priorityData.map((d) => <Cell key={d.key} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Card>
  );
}
