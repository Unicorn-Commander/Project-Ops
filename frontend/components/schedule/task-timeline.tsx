"use client";

/**
 * Task Timeline — a per-project Gantt that finally VISUALIZES task
 * dependencies as arrows.
 *
 * The master schedule (gantt.tsx) is PROJECT-keyed: its bars are projects and
 * its dependency overlay never resolves (projects have no dependency edges).
 * This view is the task-level twin — bars are THIS project's tasks, and the
 * predecessor → successor edges drawn in the task-details modal show up as
 * elbow connectors between bars.
 *
 * Layout mirrors the master schedule so the two read as one product:
 *   - A left identity column (title + assignee) and a day-scaled timeline.
 *   - Each bar is anchored by its `dueDate` and spans `createdAt → dueDate`
 *     (a sensible minimum width when that span is tiny or inverted). Colour
 *     comes from task status; a "Today" line marks now.
 *   - Tasks WITHOUT a due date can't be placed on the axis, so they drop into
 *     an "Unscheduled" lane below the chart rather than vanishing.
 *   - Dependency arrows are drawn by the SHARED <DependencyArrows> overlay
 *     (the same one the master schedule uses), measured from the live bar DOM
 *     nodes so they track resize. The longest dependency chain is highlighted
 *     as a lightweight critical path.
 *
 * Everything degrades: no tasks → empty state; tasks but no due dates → just
 * the Unscheduled lane; due dates but no dependencies → bars with no arrows.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  differenceInCalendarDays,
  format,
  isAfter,
  isWithinInterval,
  max as maxDate,
  min as minDate,
  startOfDay,
} from "date-fns";
import {
  CalendarRange,
  CircleSlash,
  GitBranch,
  ListTodo,
  Loader2,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import {
  getTaskDependencies,
  listTasks,
  Task,
  TaskStatus,
} from "@/lib/tasks-api";
import {
  DependencyArrows,
  DependencyEdge,
  useBarRegistry,
} from "@/components/schedule/dependency-arrows";
import { businessDateToday, dateOnlyToCalendarDate } from "@/lib/date-only";

// ─────────────────────────────────────────────────────────────────────────
// Status → bar styling. Calm, on-brand (indigo primary, amber in-progress),
// dark-aware. `track` is the faint full-bar wash; `fill` is the saturated
// block; `text` reads on the fill.
interface StatusStyle {
  label: string;
  track: string;
  fill: string;
  text: string;
  dot: string;
}

const STATUS_STYLES: Record<string, StatusStyle> = {
  PENDING: {
    label: "Pending",
    track: "bg-blue-500/10 dark:bg-blue-400/10",
    fill: "bg-blue-500",
    text: "text-white",
    dot: "bg-blue-500 dark:bg-blue-400",
  },
  IN_PROGRESS: {
    label: "In progress",
    track: "bg-amber-500/10 dark:bg-amber-400/10",
    fill: "bg-amber-500",
    text: "text-white",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  WAITING_FOR_CLIENT: {
    label: "Waiting for client",
    track: "bg-violet-500/10 dark:bg-violet-400/10",
    fill: "bg-violet-500",
    text: "text-white",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  COMPLETED: {
    label: "Completed",
    track: "bg-emerald-500/10 dark:bg-emerald-400/10",
    fill: "bg-emerald-500",
    text: "text-white",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  CANCELLED: {
    label: "Cancelled",
    track: "bg-zinc-500/10 dark:bg-zinc-400/10",
    fill: "bg-zinc-400 dark:bg-zinc-500",
    text: "text-white",
    dot: "bg-zinc-400 dark:bg-zinc-500",
  },
};

const FALLBACK_STYLE: StatusStyle = {
  label: "Task",
  track: "bg-indigo-500/10 dark:bg-indigo-400/10",
  fill: "bg-indigo-500",
  text: "text-white",
  dot: "bg-indigo-500 dark:bg-indigo-400",
};

function styleFor(status: string): StatusStyle {
  return STATUS_STYLES[status] ?? FALLBACK_STYLE;
}

// Minimum visual width (in days) for a bar so a same-day task still reads.
const MIN_BAR_DAYS = 2;
// Default span (in days) when a task has a due date but its computed start is
// after/equal to it (e.g. created same day or weird data) — a short lead-in.
const DEFAULT_LEAD_DAYS = 3;
// Window padding so the earliest/latest bars don't kiss the edges.
const WINDOW_PAD_DAYS = 3;
const LABEL_W = 240; // px — left identity column width

function assigneeName(t: Task): string | null {
  if (!t.assignedTo) return null;
  const full = `${t.assignedTo.firstName ?? ""} ${t.assignedTo.lastName ?? ""}`.trim();
  return full || t.assignedTo.email || null;
}

interface ScheduledTask {
  task: Task;
  /** Bar start (clamped so start < end). */
  start: Date;
  /** Bar end = due date (or completion date if earlier completed). */
  end: Date;
}

interface TaskTimelineProps {
  projectId: string;
  /** Open a task (wire to the task-details modal on the detail page). */
  onTaskClick?: (task: Task) => void;
}

export function TaskTimeline({ projectId, onTaskClick }: TaskTimelineProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [edges, setEdges] = useState<DependencyEdge[]>([]);

  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelinePx, setTimelinePx] = useState(0);
  const { barRefs, registerBar } = useBarRegistry();

  // ── Fetch this project's tasks ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    listTasks({ projectId, pageSize: 200, sortBy: "dueDate", sortDir: "asc" })
      .then((res) => {
        if (!cancelled) setTasks(res.data ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setTasks([]);
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── Split scheduled (has dueDate) vs unscheduled ───────────────────────
  const { scheduled, unscheduled } = useMemo(() => {
    const sched: ScheduledTask[] = [];
    const unsched: Task[] = [];
    for (const t of tasks) {
      if (!t.dueDate) {
        unsched.push(t);
        continue;
      }
      const due = dateOnlyToCalendarDate(t.dueDate);
      // End at the earlier of due / completion (a task finished early shouldn't
      // draw past where the work actually stopped).
      const end = t.completedAt
        ? minDate([due, startOfDay(new Date(t.completedAt))])
        : due;
      // Start from createdAt; if that lands on/after the end, back off a few
      // days so the bar has visible length.
      const created = startOfDay(new Date(t.createdAt));
      const start =
        created < end ? created : addDays(end, -DEFAULT_LEAD_DAYS);
      sched.push({ task: t, start, end });
    }
    // Stable order: by end date, then start, then title.
    sched.sort(
      (a, b) =>
        +a.end - +b.end || +a.start - +b.start || a.task.title.localeCompare(b.task.title),
    );
    return { scheduled: sched, unscheduled: unsched };
  }, [tasks]);

  // ── Time window across all scheduled bars (+ today, so "now" is in view) ─
  const axis = useMemo(() => {
    if (scheduled.length === 0) return null;
    const starts = scheduled.map((s) => s.start);
    const ends = scheduled.map((s) => s.end);
    const today = dateOnlyToCalendarDate(businessDateToday());
    const rawStart = minDate([...starts, today]);
    const rawEnd = maxDate([...ends, today]);
    const windowStart = addDays(rawStart, -WINDOW_PAD_DAYS);
    const windowEnd = addDays(rawEnd, WINDOW_PAD_DAYS);
    const totalDays = Math.max(1, differenceInCalendarDays(windowEnd, windowStart) + 1);
    return { windowStart, windowEnd, totalDays };
  }, [scheduled]);

  // Geometry (left%/width%) for each scheduled bar against the window.
  const rows = useMemo(() => {
    if (!axis) return [];
    const { windowStart, totalDays } = axis;
    return scheduled.map((s) => {
      const offsetDays = differenceInCalendarDays(s.start, windowStart);
      const spanDays = Math.max(
        MIN_BAR_DAYS,
        differenceInCalendarDays(s.end, s.start) + 1,
      );
      return {
        ...s,
        leftPct: (offsetDays / totalDays) * 100,
        widthPct: (spanDays / totalDays) * 100,
      };
    });
  }, [scheduled, axis]);

  // ── Month/segment header columns across the window ─────────────────────
  const columns = useMemo(() => {
    if (!axis) return [];
    const { windowStart, windowEnd, totalDays } = axis;
    const cols: { label: string; leftPct: number; widthPct: number }[] = [];
    let cur = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
    while (cur <= windowEnd) {
      const monthStart = maxDate([cur, windowStart]);
      const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const monthEnd = minDate([addDays(nextMonth, -1), windowEnd]);
      const offset = differenceInCalendarDays(monthStart, windowStart);
      const span = differenceInCalendarDays(monthEnd, monthStart) + 1;
      cols.push({
        label: format(cur, "MMM yyyy"),
        leftPct: (offset / totalDays) * 100,
        widthPct: (span / totalDays) * 100,
      });
      cur = nextMonth;
    }
    return cols;
  }, [axis]);

  // ── Today marker ────────────────────────────────────────────────────────
  const todayPct = useMemo(() => {
    if (!axis) return null;
    const { windowStart, windowEnd, totalDays } = axis;
    const today = dateOnlyToCalendarDate(businessDateToday());
    if (!isWithinInterval(today, { start: windowStart, end: windowEnd })) return null;
    return (differenceInCalendarDays(today, windowStart) / totalDays) * 100;
  }, [axis]);

  // ── Track the rendered timeline width for the arrow recompute key ───────
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setTimelinePx(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    setTimelinePx(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [rows.length]);

  // ── Fetch dependencies for the SCHEDULED tasks and keep only edges whose
  // both endpoints are scheduled (drawable). `blocks[]` already gives directed
  // predecessor → successor edges, so iterating it across rows enumerates
  // every edge once. Non-critical chrome: any failure → no arrows.
  const scheduledIds = useMemo(
    () => scheduled.map((s) => s.task.id).sort().join("|"),
    [scheduled],
  );

  useEffect(() => {
    let cancelled = false;
    const ids = scheduledIds ? scheduledIds.split("|") : [];
    if (ids.length < 2) {
      setEdges([]);
      return;
    }
    const painted = new Set(ids);
    (async () => {
      const results = await Promise.allSettled(
        ids.map((id) => getTaskDependencies(id)),
      );
      const collected: DependencyEdge[] = [];
      const seen = new Set<string>();
      results.forEach((res, i) => {
        if (res.status !== "fulfilled") return;
        const fromId = ids[i];
        for (const dep of res.value.blocks) {
          const toId = dep.successor?.id ?? dep.successorId;
          if (!toId || !painted.has(toId)) continue;
          const key = `${fromId}->${toId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push({ from: fromId, to: toId });
        }
      });
      if (!cancelled) setEdges(collected);
    })().catch(() => {
      if (!cancelled) setEdges([]);
    });
    return () => {
      cancelled = true;
    };
  }, [scheduledIds]);

  // ── Critical-path-ish: longest chain (by node count) through the edge DAG.
  // The backend guarantees acyclicity, so a memoised DFS with depth caching is
  // safe. We emphasise the edges along that chain.
  const emphasizedKeys = useMemo(() => {
    if (edges.length === 0) return new Set<string>();
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      const list = adj.get(e.from);
      if (list) list.push(e.to);
      else adj.set(e.from, [e.to]);
    }
    const bestLen = new Map<string, number>(); // longest path length from node
    const bestNext = new Map<string, string | null>();
    const visiting = new Set<string>();
    const dfs = (node: string): number => {
      const cached = bestLen.get(node);
      if (cached !== undefined) return cached;
      if (visiting.has(node)) return 1; // cycle guard (shouldn't happen)
      visiting.add(node);
      let best = 1;
      let next: string | null = null;
      for (const succ of adj.get(node) ?? []) {
        const len = 1 + dfs(succ);
        if (len > best) {
          best = len;
          next = succ;
        }
      }
      visiting.delete(node);
      bestLen.set(node, best);
      bestNext.set(node, next);
      return best;
    };
    // Seed from every node that appears as a predecessor.
    let startNode: string | null = null;
    let longest = 0;
    for (const from of adj.keys()) {
      const len = dfs(from);
      if (len > longest) {
        longest = len;
        startNode = from;
      }
    }
    const keys = new Set<string>();
    // A 2-node chain is just one edge — not interesting enough to highlight.
    if (startNode && longest >= 3) {
      let cur: string | null = startNode;
      while (cur) {
        const nxt: string | null = bestNext.get(cur) ?? null;
        if (nxt) keys.add(`${cur}->${nxt}`);
        cur = nxt;
      }
    }
    return keys;
  }, [edges]);

  // ── Render ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading timeline…
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-muted-foreground">
        <CalendarRange className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm font-medium text-foreground mb-1">
          {error ? "Couldn't load tasks for the timeline." : "No tasks to schedule yet."}
        </p>
        <p className="text-xs">
          {error
            ? "Try reloading the page."
            : "Add tasks with due dates and link their dependencies to see them here."}
        </p>
      </div>
    );
  }

  const today = dateOnlyToCalendarDate(businessDateToday());

  return (
    <div className="space-y-4">
      {/* Legend / hint */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <GitBranch className="h-3.5 w-3.5" />
          Arrows point from a task to the tasks it blocks
          {emphasizedKeys.size > 0 && (
            <>
              {" · "}
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-4 rounded-full bg-amber-500 dark:bg-amber-400" />
                longest chain
              </span>
            </>
          )}
        </span>
        <span>
          {scheduled.length} scheduled
          {unscheduled.length > 0 ? ` · ${unscheduled.length} unscheduled` : ""}
        </span>
      </div>

      {/* ── Chart ────────────────────────────────────────────────────────── */}
      {rows.length > 0 && axis ? (
        <div className="rounded-lg border border-border overflow-hidden">
          {/* Month header */}
          <div className="flex border-b bg-muted/30">
            <div
              className="shrink-0 px-3 py-2 border-r"
              style={{ width: LABEL_W }}
            >
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Task
              </span>
            </div>
            <div className="relative flex-1 h-7">
              {columns.map((col, i) => (
                <div
                  key={i}
                  className={cn(
                    "absolute top-0 bottom-0 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate",
                    i > 0 && "border-l border-border/60",
                  )}
                  style={{ left: `${col.leftPct}%`, width: `${col.widthPct}%` }}
                >
                  {col.label}
                </div>
              ))}
            </div>
          </div>

          {/* Body — rows + arrow overlay + today line */}
          <div className="relative" ref={timelineRef}>
            {rows.map((row) => {
              const st = styleFor(row.task.status);
              const name = assigneeName(row.task);
              const isOverdue =
                row.task.status !== TaskStatus.COMPLETED &&
                row.task.status !== TaskStatus.CANCELLED &&
                !!row.task.dueDate &&
                isAfter(today, dateOnlyToCalendarDate(row.task.dueDate));
              return (
                <div
                  key={row.task.id}
                  className="flex border-b last:border-b-0 hover:bg-muted/30 transition-colors group"
                  onClick={() => onTaskClick?.(row.task)}
                  role={onTaskClick ? "button" : undefined}
                >
                  {/* Identity column */}
                  <div
                    className={cn(
                      "shrink-0 px-3 py-2.5 border-r flex flex-col justify-center gap-1",
                      onTaskClick && "cursor-pointer",
                    )}
                    style={{ width: LABEL_W }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={cn("inline-block h-2 w-2 rounded-full shrink-0", st.dot)}
                      />
                      <span className="text-sm font-medium text-foreground truncate group-hover:underline">
                        {row.task.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 min-w-0 pl-3.5">
                      {name ? (
                        <span className="inline-flex items-center gap-1 min-w-0">
                          <Avatar name={name} size={15} />
                          <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                            {name}
                          </span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
                          <CircleSlash className="h-3 w-3" />
                          Unassigned
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Timeline cell */}
                  <div className="relative flex-1 h-12">
                    {/* Month dividers */}
                    {columns.map((col, i) =>
                      i > 0 ? (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 border-l border-border/40"
                          style={{ left: `${col.leftPct}%` }}
                        />
                      ) : null,
                    )}
                    {/* The bar */}
                    <div
                      ref={(el) => registerBar(row.task.id, el)}
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 h-6 rounded-md overflow-hidden flex items-center shadow-sm group-hover:shadow-md ring-1 ring-inset ring-border/50",
                        st.track,
                        isOverdue && "ring-2 ring-rose-500 ring-offset-1 ring-offset-background",
                      )}
                      style={{
                        left: `calc(${row.leftPct}% + 2px)`,
                        width: `calc(${row.widthPct}% - 4px)`,
                      }}
                      title={`${row.task.title}\n${st.label}${isOverdue ? " (overdue)" : ""}\n${format(row.start, "MMM d, yyyy")} → ${format(row.end, "MMM d, yyyy")}${name ? `\n${name}` : ""}`}
                    >
                      {/* Solid fill (completed = full; else a status block that
                          fills the bar so the colour reads). */}
                      <div className={cn("absolute inset-0", st.fill, "opacity-90")} />
                      <span
                        className={cn(
                          "relative z-10 px-2 text-[10px] font-semibold truncate",
                          st.text,
                        )}
                      >
                        {st.label}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Dependency arrows — shared overlay, measured from live bars.
                Recomputes on painted-set / width change. */}
            <DependencyArrows
              edges={edges}
              barRefs={barRefs}
              containerRef={timelineRef}
              recomputeKey={`${scheduledIds}|${timelinePx}`}
              emphasizedKeys={emphasizedKeys}
            />

            {/* Today line */}
            {todayPct !== null && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-30"
                style={{
                  left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${todayPct} / 100)`,
                }}
              >
                <div className="h-full w-px border-l-2 border-dashed border-rose-500 dark:border-rose-400 opacity-80" />
                <div className="absolute -top-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-rose-500 text-white text-[9px] font-semibold uppercase tracking-wider">
                  Today
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        // Tasks exist but none have due dates → no axis to draw. The
        // Unscheduled lane below carries them.
        <div className="rounded-lg border border-dashed border-border px-6 py-8 text-center text-sm text-muted-foreground">
          No tasks have a due date yet, so there's nothing to place on the
          timeline. Set due dates to schedule them.
        </div>
      )}

      {/* ── Unscheduled lane ───────────────────────────────────────────────── */}
      {unscheduled.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
            <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Unscheduled
            </span>
            <span className="ml-auto inline-flex items-center justify-center rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {unscheduled.length}
            </span>
          </div>
          <div className="divide-y divide-border">
            {unscheduled.map((t) => {
              const st = styleFor(t.status);
              const name = assigneeName(t);
              return (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors group",
                    onTaskClick && "cursor-pointer",
                  )}
                  onClick={() => onTaskClick?.(t)}
                  role={onTaskClick ? "button" : undefined}
                >
                  <span className={cn("inline-block h-2 w-2 rounded-full shrink-0", st.dot)} />
                  <span className="text-sm font-medium text-foreground truncate group-hover:underline">
                    {t.title}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {st.label}
                  </span>
                  {name && (
                    <span className="ml-auto inline-flex items-center gap-1 shrink-0">
                      <Avatar name={name} size={15} />
                      <span className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                        {name}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
