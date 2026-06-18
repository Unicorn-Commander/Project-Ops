"use client";

/**
 * Master Schedule — a showcase Gantt built around our existing project
 * colour palette so the schedule view is visually continuous with the
 * kanban + dashboard.
 *
 * Design choices that matter:
 *
 *  - Timeline is N columns of equal width, each column = one ${zoomUnit}
 *    (3-month / 6-month / year / 18-month spread). Bars are positioned via
 *    CSS percentage, so resizing the viewport reflows naturally.
 *  - Each project bar uses `projectColorClasses(id)` so the schedule "rows"
 *    read with the same colour identity as kanban cards and dashboard rows.
 *    The bar carries a *progress fill* (project colour) over a faint track,
 *    so completion reads at a glance.
 *  - "Today" is a vertical line spanning the body, dashed for distinction
 *    against the underlying month grid.
 *  - GROUP-BY (v1.9): the headline feature. Rows can be grouped by
 *    Customer/Org (default), Product (category), Owner/Assignee, Status, or
 *    shown Flat. Grouped views render collapsible swimlanes with a faint
 *    "rollup" span covering the group's earliest start → latest end. The
 *    choice persists to localStorage so the operator's lens sticks.
 *  - A summary ribbon up top gives live counts (Active · Overdue · Due this
 *    week · Avg progress), themed via badge-style tokens so it reads in
 *    light / dark / vibrant.
 *  - Drag-to-reschedule: pointer-down on a bar starts a drag, pointer-move
 *    shows a live preview translation, pointer-up fires `onReschedule`.
 *
 * Performance: grouping + row geometry is memoised, and only rows whose true
 * range overlaps the visible window are rendered — so ~1000 projects stay
 * smooth (we never paint off-window rows).
 */

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "next/navigation";
import {
  format,
  addMonths,
  addDays,
  startOfMonth,
  endOfMonth,
  startOfDay,
  differenceInCalendarDays,
  isWithinInterval,
  isAfter,
  isBefore,
  max as maxDate,
  min as minDate,
} from "date-fns";
import {
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CalendarRange,
  Layers,
  Building2,
  Tag,
  UserCircle,
  Activity,
  List,
  CircleSlash,
  AlertTriangle,
  CalendarClock,
  Gauge,
} from "lucide-react";
import { projectColorClasses } from "@/lib/project-colors";
import { cn } from "@/lib/utils";
import { getTaskDependencies } from "@/lib/tasks-api";
import { DependencyArrows, useBarRegistry } from "@/components/schedule/dependency-arrows";

// ─────────────────────────────────────────────────────────────────────────
// Types

export interface ScheduleProject {
  id: string;
  projectNumber: string;
  title: string;
  status: string;
  priority: string;
  clientName: string;
  organizationId?: string | null;
  organization?: { id: string; name: string } | null;
  assignedToId?: string | null;
  assignedTo?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  createdAt: string;
  dueDate: string | null;
  completedAt: string | null;
  /** Shared contract (v1.9): task rollup for the progress fill. */
  taskStats?: { total: number; completed: number } | null;
  /** Shared contract (v1.9): product/category lane. */
  category?: string | null;
  /** Shared contract (v1.9): free-form labels (JSON array of strings). */
  tags?: string[] | null;
}

interface GanttProps {
  projects: ScheduleProject[];
  /**
   * If supplied, bars become draggable: pointer-down on a bar starts a
   * drag, pointer-move shows a live preview translation, pointer-up
   * fires this callback with the new due date. Receivers should PATCH
   * /projects/:id then refresh the project list.
   *
   * If omitted, bars are read-only.
   */
  onReschedule?: (projectId: string, newDueDate: Date) => void | Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────
// Zoom levels — each defines how much wall-clock time fits in the visible
// area. We always render NUM_COLS columns, just labelled differently.

const ZOOM_LEVELS = {
  "3-months":  { months: 3,  label: "3 months",  step: 1 }, // 3 months across
  "6-months":  { months: 6,  label: "6 months",  step: 1 }, // 6 months across
  "year":      { months: 12, label: "Year",      step: 1 }, // 12 months
  "18-months": { months: 18, label: "18 months", step: 2 }, // 9 columns of 2 months
} as const;

type ZoomKey = keyof typeof ZOOM_LEVELS;

// ─────────────────────────────────────────────────────────────────────────
// Group-by modes — the headline lens switch.

type GroupBy = "org" | "category" | "assignee" | "status" | "none";

const GROUP_OPTIONS: { value: GroupBy; label: string; icon: typeof Layers }[] = [
  { value: "org",      label: "Customer / Org", icon: Building2 },
  { value: "category", label: "Product",        icon: Tag },
  { value: "assignee", label: "Owner",          icon: UserCircle },
  { value: "status",   label: "Status",         icon: Activity },
  { value: "none",     label: "Flat",           icon: List },
];

const GROUP_STORAGE_KEY = "po.schedule.groupBy";
const UNGROUPED_KEY = "__ungrouped__";

const STATUS_LABEL: Record<string, string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  UNDER_REVIEW: "Under review",
  COMPLETED: "Completed",
  ON_HOLD: "On hold",
  ARCHIVED: "Archived",
};

// Stable, sensible ordering for the status lanes (active work first, the
// terminal/parked lanes last) so the board reads top-to-bottom by urgency.
const STATUS_ORDER = [
  "NEW",
  "IN_PROGRESS",
  "UNDER_REVIEW",
  "ON_HOLD",
  "COMPLETED",
  "ARCHIVED",
];

// ─────────────────────────────────────────────────────────────────────────
// Helpers

function assigneeName(p: ScheduleProject): string | null {
  if (!p.assignedTo) return null;
  const full = `${p.assignedTo.firstName ?? ""} ${p.assignedTo.lastName ?? ""}`.trim();
  return full || p.assignedTo.email || null;
}

/** Derived completion 0–100. A completed project always reads 100%. */
function progressPctFor(p: ScheduleProject): number {
  const total = p.taskStats?.total ?? 0;
  const completed = p.taskStats?.completed ?? 0;
  if (total > 0) return Math.round((100 * completed) / total);
  return p.status === "COMPLETED" ? 100 : 0;
}

// ─────────────────────────────────────────────────────────────────────────

export function Gantt({ projects, onReschedule }: GanttProps) {
  const router = useRouter();
  const [zoom, setZoom] = useState<ZoomKey>("6-months");
  const [anchorMonth, setAnchorMonth] = useState<Date>(() => startOfMonth(new Date()));

  // Group-by lens — persisted so the operator's chosen view sticks across
  // sessions. Default = Customer/Org (answers "work across customers").
  const [groupBy, setGroupBy] = useState<GroupBy>("org");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(GROUP_STORAGE_KEY) as GroupBy | null;
    if (saved && GROUP_OPTIONS.some((o) => o.value === saved)) {
      setGroupBy(saved);
    }
  }, []);
  const changeGroupBy = useCallback((next: GroupBy) => {
    setGroupBy(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(GROUP_STORAGE_KEY, next);
    }
  }, []);

  // Collapsed group ids (per group-by lens). Cleared when the lens changes
  // so collapse-state doesn't leak between two different groupings.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setCollapsed(new Set());
  }, [groupBy]);
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Filter state
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterPriority, setFilterPriority] = useState<string>("ALL");
  const [filterOrg, setFilterOrg] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(false);

  // Drag-to-reschedule state. Active when the user is mid-drag on a bar.
  // dxDays is recomputed on every pointermove.
  const [drag, setDrag] = useState<{
    projectId: string;
    startX: number;
    originalEnd: Date;
    dxDays: number;
    didMove: boolean;
  } | null>(null);

  // Pixels-per-day depends on the rendered timeline width (everything to
  // the right of the label column). Recomputed on resize so a window-resize
  // during drag still gives accurate day deltas.
  const timelineRef = useRef<HTMLDivElement>(null);
  const [timelinePx, setTimelinePx] = useState(0);
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setTimelinePx(w);
    });
    ro.observe(el);
    setTimelinePx(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const z = ZOOM_LEVELS[zoom];
  // Visible window starts 1 month before the anchor for readability — so
  // "today" is roughly a third of the way in by default.
  const windowStart = useMemo(() => addMonths(startOfMonth(anchorMonth), -1), [anchorMonth]);
  const windowEnd = useMemo(() => endOfMonth(addMonths(windowStart, z.months - 1)), [windowStart, z.months]);
  const totalDays = differenceInCalendarDays(windowEnd, windowStart) + 1;

  // Build column headers based on zoom step
  const columns = useMemo(() => {
    const cols: { start: Date; end: Date; label: string }[] = [];
    let cur = new Date(windowStart);
    while (cur <= windowEnd) {
      const colEnd = endOfMonth(addMonths(cur, z.step - 1));
      cols.push({
        start: cur,
        end: colEnd,
        label: z.step === 1 ? format(cur, "MMM yyyy") : `${format(cur, "MMM")}–${format(colEnd, "MMM yyyy")}`,
      });
      cur = addMonths(cur, z.step);
    }
    return cols;
  }, [windowStart, windowEnd, z.step]);

  // Available filter options derived from data
  const orgOptions = useMemo(() => {
    const seen = new Map<string, string>();
    projects.forEach((p) => {
      if (p.organization?.id && p.organization.name) {
        seen.set(p.organization.id, p.organization.name);
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [projects]);

  // Apply filters
  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterStatus !== "ALL" && p.status !== filterStatus) return false;
      if (filterPriority !== "ALL" && p.priority !== filterPriority) return false;
      if (filterOrg !== "ALL" && p.organizationId !== filterOrg) return false;
      return true;
    });
  }, [projects, filterStatus, filterPriority, filterOrg]);

  // Compute the full geometry (start/end + visibility + position) for one
  // project against the visible window. Pure helper so we can reuse it for
  // both rows and group rollups.
  const geometryOf = useCallback(
    (p: ScheduleProject) => {
      const start = startOfDay(new Date(p.createdAt));
      // If no due date, show as a ~1-month bar from the start (visual
      // presence without faking commitment). If completed, end at completedAt.
      const explicitEnd = p.completedAt
        ? new Date(p.completedAt)
        : p.dueDate
          ? new Date(p.dueDate)
          : addMonths(start, 1);
      const end = startOfDay(explicitEnd);

      const overlapStart = maxDate([start, windowStart]);
      const overlapEnd = minDate([end, windowEnd]);
      const visible = isAfter(overlapEnd, windowStart) && isBefore(overlapStart, windowEnd);

      const offsetDays = differenceInCalendarDays(maxDate([start, windowStart]), windowStart);
      const widthDays = Math.max(
        1,
        differenceInCalendarDays(minDate([end, windowEnd]), maxDate([start, windowStart])) + 1,
      );

      return {
        start,
        end,
        visible,
        leftPct: (offsetDays / totalDays) * 100,
        widthPct: (widthDays / totalDays) * 100,
        overflowLeft: isBefore(start, windowStart),
        overflowRight: isAfter(end, windowEnd),
      };
    },
    [windowStart, windowEnd, totalDays],
  );

  // ── Grouping ──────────────────────────────────────────────────────────
  // Bucket the (already window-visible) rows by the active lens, compute a
  // per-group rollup span (earliest start → latest end across the group's
  // *true* ranges, clamped to the window for drawing), and sort the lanes.
  //
  // Each row carries its precomputed geometry so the body render is a thin
  // map with no per-row date math.
  interface Row {
    project: ScheduleProject;
    geo: ReturnType<typeof geometryOf>;
  }
  interface Group {
    key: string;
    label: string;
    rows: Row[];
    /** Rollup span across the group, clamped to window, as %. */
    rollupLeftPct: number;
    rollupWidthPct: number;
    rollupVisible: boolean;
  }

  const groups = useMemo<Group[]>(() => {
    // 1) Compute geometry once, keep only window-visible rows.
    const visibleRows: Row[] = [];
    for (const p of filteredProjects) {
      const geo = geometryOf(p);
      if (geo.visible) visibleRows.push({ project: p, geo });
    }

    // 2) Bucket by lens.
    const keyFor = (p: ScheduleProject): { key: string; label: string } => {
      switch (groupBy) {
        case "org":
          return p.organization?.id
            ? { key: p.organization.id, label: p.organization.name }
            : { key: UNGROUPED_KEY, label: p.clientName || "No organization" };
        case "category":
          return p.category
            ? { key: p.category, label: p.category }
            : { key: UNGROUPED_KEY, label: "Uncategorized" };
        case "assignee": {
          const name = assigneeName(p);
          return p.assignedToId && name
            ? { key: p.assignedToId, label: name }
            : { key: UNGROUPED_KEY, label: "Unassigned" };
        }
        case "status":
          return { key: p.status, label: STATUS_LABEL[p.status] ?? p.status };
        case "none":
        default:
          return { key: UNGROUPED_KEY, label: "" };
      }
    };

    const buckets = new Map<string, { label: string; rows: Row[] }>();
    for (const row of visibleRows) {
      const { key, label } = keyFor(row.project);
      const existing = buckets.get(key);
      if (existing) existing.rows.push(row);
      else buckets.set(key, { label, rows: [row] });
    }

    // 3) Build Group objects with rollup spans + window clamping.
    const out: Group[] = [];
    buckets.forEach(({ label, rows }, key) => {
      let earliest: Date | null = null;
      let latest: Date | null = null;
      for (const r of rows) {
        if (!earliest || isBefore(r.geo.start, earliest)) earliest = r.geo.start;
        if (!latest || isAfter(r.geo.end, latest)) latest = r.geo.end;
      }
      let rollupLeftPct = 0;
      let rollupWidthPct = 0;
      let rollupVisible = false;
      if (earliest && latest) {
        const clampStart = maxDate([earliest, windowStart]);
        const clampEnd = minDate([latest, windowEnd]);
        if (isBefore(clampStart, clampEnd) || +clampStart === +clampEnd) {
          const offset = differenceInCalendarDays(clampStart, windowStart);
          const width = Math.max(1, differenceInCalendarDays(clampEnd, clampStart) + 1);
          rollupLeftPct = (offset / totalDays) * 100;
          rollupWidthPct = (width / totalDays) * 100;
          rollupVisible = true;
        }
      }
      out.push({ key, label, rows, rollupLeftPct, rollupWidthPct, rollupVisible });
    });

    // 4) Order lanes.
    if (groupBy === "status") {
      out.sort(
        (a, b) =>
          (STATUS_ORDER.indexOf(a.key) + 1 || 99) - (STATUS_ORDER.indexOf(b.key) + 1 || 99),
      );
    } else if (groupBy === "none") {
      // Single bucket; nothing to sort.
    } else {
      // Alphabetical, but push the "ungrouped" lane to the bottom.
      out.sort((a, b) => {
        if (a.key === UNGROUPED_KEY) return 1;
        if (b.key === UNGROUPED_KEY) return -1;
        return a.label.localeCompare(b.label);
      });
    }

    return out;
  }, [filteredProjects, geometryOf, groupBy, windowStart, windowEnd, totalDays]);

  const visibleRowCount = useMemo(
    () => groups.reduce((sum, g) => sum + g.rows.length, 0),
    [groups],
  );

  // ── Dependency arrows ────────────────────────────────────────────────────
  // The set of row ids whose bars are actually painted right now (visible in
  // the window AND not inside a collapsed group). Arrows are only drawn between
  // two painted bars.
  const paintedRowIds = useMemo(() => {
    const hasHeaders = groupBy !== "none";
    const ids = new Set<string>();
    for (const g of groups) {
      if (hasHeaders && collapsed.has(g.key)) continue;
      for (const r of g.rows) ids.add(r.project.id);
    }
    return ids;
  }, [groups, collapsed, groupBy]);

  // Fetch dependency edges for the painted rows and keep only edges whose BOTH
  // endpoints are currently painted (predecessor → successor). The backend
  // exposes dependencies per row id via GET /:id/dependencies; rows with no
  // edges simply contribute nothing, so the layer degrades to empty gracefully.
  // Bars register their live DOM node in `barRefs` so the arrow overlay can
  // measure real pixel positions (robust to zoom / collapse / drag).
  const { barRefs, registerBar } = useBarRegistry();

  const [edges, setEdges] = useState<{ from: string; to: string }[]>([]);
  // Stable key for the painted set so the fetch effect only re-runs when the
  // membership actually changes (not on every render).
  const paintedKey = useMemo(
    () => Array.from(paintedRowIds).sort().join("|"),
    [paintedRowIds],
  );

  useEffect(() => {
    let cancelled = false;
    const ids = paintedKey ? paintedKey.split("|") : [];
    if (ids.length < 2) {
      setEdges([]);
      return;
    }
    (async () => {
      const painted = new Set(ids);
      const collected: { from: string; to: string }[] = [];
      const seen = new Set<string>();
      // One request per painted row. `blocks[]` already gives directed
      // predecessor→successor edges from this row, so iterating `blocks`
      // across all rows enumerates every edge exactly once.
      const results = await Promise.allSettled(
        ids.map((id) => getTaskDependencies(id)),
      );
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
      // Dependency arrows are non-critical chrome — never let a failed fetch
      // break the schedule. Just render no arrows.
      if (!cancelled) setEdges([]);
    });
    return () => {
      cancelled = true;
    };
  }, [paintedKey]);

  // ── Summary ribbon metrics ──────────────────────────────────────────────
  // Computed over the *filtered* set (the operator's current scope), not just
  // the window, so the ribbon reads as a real portfolio summary.
  const summary = useMemo(() => {
    const today = startOfDay(new Date());
    const weekEnd = addDays(today, 7);
    let active = 0;
    let overdue = 0;
    let dueThisWeek = 0;
    let progressSum = 0;
    let progressN = 0;
    for (const p of filteredProjects) {
      const isCompleted = !!p.completedAt || p.status === "COMPLETED";
      const isParked = p.status === "ARCHIVED";
      if (!isCompleted && !isParked) active += 1;
      if (p.dueDate) {
        const due = startOfDay(new Date(p.dueDate));
        if (!isCompleted && isBefore(due, today)) overdue += 1;
        if (!isCompleted && isWithinInterval(due, { start: today, end: weekEnd })) {
          dueThisWeek += 1;
        }
      }
      if (!isParked) {
        progressSum += progressPctFor(p);
        progressN += 1;
      }
    }
    const avgProgress = progressN > 0 ? Math.round(progressSum / progressN) : 0;
    return { active, overdue, dueThisWeek, avgProgress };
  }, [filteredProjects]);

  // Today indicator
  const today = startOfDay(new Date());
  const todayInWindow = isWithinInterval(today, { start: windowStart, end: windowEnd });
  const todayPct = todayInWindow
    ? (differenceInCalendarDays(today, windowStart) / totalDays) * 100
    : null;

  const LABEL_W = 280; // px — the left identity column width
  const pixelsPerDay = timelinePx > 0 ? (timelinePx - LABEL_W) / totalDays : 0;
  const showGroupHeaders = groupBy !== "none";

  return (
    <div className="space-y-4">
      {/* ── Summary ribbon ─────────────────────────────────────────────── */}
      <SummaryRibbon
        active={summary.active}
        overdue={summary.overdue}
        dueThisWeek={summary.dueThisWeek}
        avgProgress={summary.avgProgress}
      />

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: timeline navigation */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setAnchorMonth((d) => addMonths(d, -1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnchorMonth(startOfMonth(new Date()))}
            >
              <CalendarRange className="h-4 w-4 mr-1.5" />
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setAnchorMonth((d) => addMonths(d, 1))}
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Right: group-by + zoom + filters */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Group-by lens — the headline control. */}
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-1.5 py-1">
              <Layers className="h-3.5 w-3.5 text-muted-foreground ml-1" />
              <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
                Group
              </span>
              <Select value={groupBy} onValueChange={(v) => changeGroupBy(v as GroupBy)}>
                <SelectTrigger className="h-7 w-[150px] border-0 bg-transparent shadow-none focus:ring-0 px-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          {opt.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <Select value={zoom} onValueChange={(v) => setZoom(v as ZoomKey)}>
              <SelectTrigger className="w-[130px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ZOOM_LEVELS) as ZoomKey[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ZOOM_LEVELS[k].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters((s) => !s)}
            >
              <Filter className="h-4 w-4 mr-1.5" />
              Filters
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t">
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="NEW">New</SelectItem>
                <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                <SelectItem value="UNDER_REVIEW">Under review</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="ON_HOLD">On hold</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger>
                <SelectValue placeholder="All priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All priorities</SelectItem>
                <SelectItem value="LOW">Low</SelectItem>
                <SelectItem value="MEDIUM">Medium</SelectItem>
                <SelectItem value="HIGH">High</SelectItem>
                <SelectItem value="URGENT">Urgent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterOrg} onValueChange={setFilterOrg}>
              <SelectTrigger>
                <SelectValue placeholder="All organizations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All organizations</SelectItem>
                {orgOptions.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </Card>

      {/* ── Gantt body ─────────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {/* Header row — column labels */}
        <div className="flex border-b">
          <div
            className="shrink-0 px-4 py-3 border-r bg-muted/30"
            style={{ width: LABEL_W }}
          >
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {GROUP_OPTIONS.find((o) => o.value === groupBy)?.label ?? "Project"}
            </div>
          </div>
          <div
            className="relative flex-1 grid"
            style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
          >
            {columns.map((col, i) => (
              <div
                key={i}
                className={`px-3 py-3 text-xs font-medium uppercase tracking-wider text-muted-foreground ${i > 0 ? "border-l" : ""}`}
              >
                {col.label}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        {visibleRowCount === 0 ? (
          <div className="px-6 py-16 text-center text-muted-foreground">
            <CalendarRange className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm font-medium text-foreground mb-1">
              No projects fit the current window or filters.
            </p>
            <p className="text-xs">
              Use the navigation arrows to move the timeline, or clear the filters.
            </p>
          </div>
        ) : (
          <div className="relative" ref={timelineRef}>
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.key);
              return (
                <div key={group.key}>
                  {/* ── Swimlane header ──────────────────────────────── */}
                  {showGroupHeaders && (
                    <div
                      className="flex border-b bg-muted/40 hover:bg-muted/60 transition-colors cursor-pointer select-none"
                      onClick={() => toggleGroup(group.key)}
                      role="button"
                      aria-expanded={!isCollapsed}
                      aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${group.label}`}
                    >
                      <div
                        className="shrink-0 px-4 py-2.5 border-r flex items-center gap-2"
                        style={{ width: LABEL_W }}
                      >
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0",
                            isCollapsed && "-rotate-90",
                          )}
                        />
                        <span className="text-sm font-semibold text-foreground truncate">
                          {group.label}
                        </span>
                        <span className="ml-auto inline-flex items-center justify-center rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground shrink-0">
                          {group.rows.length}
                        </span>
                      </div>
                      {/* Rollup span across the group on the timeline */}
                      <div
                        className="relative flex-1 grid h-9"
                        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
                      >
                        {columns.map((_, i) => (
                          <div key={i} className={`h-full ${i > 0 ? "border-l border-border/40" : ""}`} />
                        ))}
                        {group.rollupVisible && (
                          <div
                            className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-foreground/15 dark:bg-foreground/20 pointer-events-none"
                            style={{
                              left: `calc(${group.rollupLeftPct}% + 2px)`,
                              width: `calc(${group.rollupWidthPct}% - 4px)`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Rows ─────────────────────────────────────────── */}
                  {!isCollapsed &&
                    group.rows.map(({ project, geo }) => (
                      <ScheduleRow
                        key={project.id}
                        project={project}
                        geo={geo}
                        columnsLength={columns.length}
                        labelWidth={LABEL_W}
                        today={today}
                        indented={showGroupHeaders}
                        drag={drag}
                        setDrag={setDrag}
                        pixelsPerDay={pixelsPerDay}
                        onReschedule={onReschedule}
                        onOpen={(id) => router.push(`/dashboard/projects/${id}`)}
                        registerBar={registerBar}
                      />
                    ))}
                </div>
              );
            })}

            {/* Dependency arrows — SVG overlay tracking real bar positions.
                Recomputes when the painted set, the edges, zoom, collapse, or
                drag changes. Sits under the Today line (z-30) so urgency wins. */}
            <DependencyArrows
              edges={edges}
              barRefs={barRefs}
              containerRef={timelineRef}
              recomputeKey={`${paintedKey}|${zoom}|${timelinePx}|${drag?.projectId ?? ""}:${drag?.dxDays ?? 0}`}
            />

            {/* Today vertical line — drawn over body rows so it shows through */}
            {todayPct !== null && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none z-30"
                style={{
                  left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${todayPct} / 100)`,
                }}
              >
                <div className="h-full w-px border-l-2 border-dashed border-rose-500 dark:border-rose-400 opacity-80" />
                <div className="absolute -top-1 -translate-x-1/2 px-1.5 py-0.5 rounded bg-rose-500 dark:bg-rose-500 text-white text-[9px] font-semibold uppercase tracking-wider">
                  Today
                </div>
              </div>
            )}
          </div>
        )}

        {/* Legend / count */}
        <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30 text-xs text-muted-foreground">
          <span>
            Showing {visibleRowCount} of {filteredProjects.length} project
            {filteredProjects.length === 1 ? "" : "s"} in this window —{" "}
            {projects.length} total in scope.
          </span>
          <span className="hidden sm:inline">
            {onReschedule
              ? "Click a row to open · drag a bar to reschedule"
              : "Click a row to open the project"}
          </span>
        </div>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Summary ribbon — polished dashboard strip with live counts. Theme-correct
// (badge-style opacity tints, dark-aware), responsive.

function SummaryRibbon({
  active,
  overdue,
  dueThisWeek,
  avgProgress,
}: {
  active: number;
  overdue: number;
  dueThisWeek: number;
  avgProgress: number;
}) {
  const stats: {
    label: string;
    value: string | number;
    icon: typeof Activity;
    tint: string;
    iconWell: string;
  }[] = [
    {
      label: "Active",
      value: active,
      icon: Activity,
      tint: "text-foreground",
      iconWell: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
    },
    {
      label: "Overdue",
      value: overdue,
      icon: AlertTriangle,
      tint: overdue > 0 ? "text-rose-600 dark:text-rose-300" : "text-foreground",
      iconWell: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    },
    {
      label: "Due this week",
      value: dueThisWeek,
      icon: CalendarClock,
      tint: dueThisWeek > 0 ? "text-amber-600 dark:text-amber-300" : "text-foreground",
      iconWell: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    },
    {
      label: "Avg progress",
      value: `${avgProgress}%`,
      icon: Gauge,
      tint: "text-foreground",
      iconWell: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    },
  ];

  return (
    <Card className="p-0 overflow-hidden">
      <div className="grid grid-cols-2 lg:grid-cols-4 divide-y divide-x divide-border lg:divide-y-0">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-center gap-3 px-4 py-3.5">
              <span
                className={cn(
                  "inline-flex h-10 w-10 items-center justify-center rounded-lg shrink-0",
                  s.iconWell,
                )}
              >
                <Icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <div className={cn("text-2xl font-bold leading-none tabular-nums", s.tint)}>
                  {s.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground truncate">{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// A single schedule row — identity column + timeline bar with progress
// fill, milestone diamond, assignee chip, overdue treatment, and the
// drag-to-reschedule pointer handlers. Memoised so unrelated rows don't
// re-render while one bar is being dragged.

interface ScheduleRowProps {
  project: ScheduleProject;
  geo: {
    start: Date;
    end: Date;
    leftPct: number;
    widthPct: number;
    overflowLeft: boolean;
    overflowRight: boolean;
  };
  columnsLength: number;
  labelWidth: number;
  today: Date;
  indented: boolean;
  drag: {
    projectId: string;
    startX: number;
    originalEnd: Date;
    dxDays: number;
    didMove: boolean;
  } | null;
  setDrag: (
    d:
      | {
          projectId: string;
          startX: number;
          originalEnd: Date;
          dxDays: number;
          didMove: boolean;
        }
      | null,
  ) => void;
  pixelsPerDay: number;
  onReschedule?: (projectId: string, newDueDate: Date) => void | Promise<void>;
  onOpen: (id: string) => void;
  /** Registers this row's bar element by id so the arrow overlay can measure it. */
  registerBar: (id: string, el: HTMLElement | null) => void;
}

function ScheduleRow({
  project,
  geo,
  columnsLength,
  labelWidth,
  today,
  indented,
  drag,
  setDrag,
  pixelsPerDay,
  onReschedule,
  registerBar,
  onOpen,
}: ScheduleRowProps) {
  const { leftPct, widthPct, overflowRight, end } = geo;
  const pc = projectColorClasses(project.id);
  const isCompleted = !!project.completedAt || project.status === "COMPLETED";
  const isOverdue =
    !isCompleted && !!project.dueDate && isAfter(today, new Date(project.dueDate));
  const isDragging = drag?.projectId === project.id;
  const draggable = !!onReschedule && !isCompleted && !!project.dueDate;
  const dragOffsetPx = isDragging ? drag!.dxDays * pixelsPerDay : 0;
  const previewDate = isDragging ? addDays(drag!.originalEnd, drag!.dxDays) : null;

  const progress = isCompleted ? 100 : progressPctFor(project);
  const name = assigneeName(project);

  // Milestone diamond sits at the due date (or completion date). Only drawn
  // when that date lands inside the visible window (i.e. at the bar's end).
  const showDiamond = !!project.dueDate || isCompleted;
  // The diamond rides the right edge of the bar; if the bar overflows right
  // the real end is off-window so we suppress it.
  const diamondAtRightEdge = !overflowRight;

  const tags = Array.isArray(project.tags) ? project.tags : [];

  return (
    <div
      className="flex border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer group"
      onClick={(e) => {
        // Suppress navigation if a drag just happened on this row.
        if (drag || (e as unknown as { __justDragged?: boolean }).__justDragged) return;
        onOpen(project.id);
      }}
    >
      {/* Identity column */}
      <div
        className={`shrink-0 px-3 py-3 border-r flex flex-col justify-center gap-1.5 border-l-4 ${pc.borderLeft} ${pc.cardWash} ${indented ? "pl-6" : ""}`}
        style={{ width: labelWidth }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium shrink-0 ${pc.badgeBg} ${pc.badgeText}`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${pc.dot}`} />
            {project.projectNumber.replace("PROJ-2026-", "P-")}
          </span>
          <span className="text-sm font-medium text-foreground truncate group-hover:underline">
            {project.title}
          </span>
        </div>
        {/* Sub-line: assignee + tags */}
        <div className="flex items-center gap-1.5 min-w-0">
          {name ? (
            <span className="inline-flex items-center gap-1 min-w-0">
              <Avatar name={name} size={16} />
              <span className="text-[11px] text-muted-foreground truncate max-w-[110px]">
                {name}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
              <CircleSlash className="h-3 w-3" />
              Unassigned
            </span>
          )}
          {tags.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground truncate">
              <Tag className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{tags.slice(0, 2).join(", ")}</span>
              {tags.length > 2 && <span className="shrink-0">+{tags.length - 2}</span>}
            </span>
          )}
        </div>
      </div>

      {/* Timeline cell */}
      <div
        className="relative flex-1 grid h-14"
        style={{ gridTemplateColumns: `repeat(${columnsLength}, minmax(0, 1fr))` }}
      >
        {/* Column dividers */}
        {Array.from({ length: columnsLength }).map((_, i) => (
          <div key={i} className={`h-full ${i > 0 ? "border-l border-border/60" : ""}`} />
        ))}

        {/* The bar — a faint track with a project-colour progress fill. */}
        <div
          ref={(el) => registerBar(project.id, el)}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 h-7 rounded-md overflow-hidden flex items-center shadow-sm group-hover:shadow-md ring-1 ring-inset",
            pc.cardWash,
            isCompleted ? "ring-border/70" : "ring-border/50",
            isDragging ? "ring-2 ring-primary shadow-lg z-20" : "transition-all",
            draggable ? "cursor-grab active:cursor-grabbing" : "",
          )}
          style={{
            left: `calc(${leftPct}% + 2px)`,
            width: `calc(${widthPct}% - 4px)`,
            transform: isDragging ? `translateX(${dragOffsetPx}px)` : undefined,
          }}
          title={`${project.projectNumber} · ${project.title}\n${format(new Date(project.createdAt), "MMM d, yyyy")} → ${project.completedAt ? format(new Date(project.completedAt), "MMM d, yyyy") + " (completed)" : project.dueDate ? format(new Date(project.dueDate), "MMM d, yyyy") + (isOverdue ? " (overdue)" : "") : "ongoing"}\n${progress}% complete${project.taskStats && project.taskStats.total > 0 ? ` (${project.taskStats.completed}/${project.taskStats.total} tasks)` : ""}`}
          onPointerDown={(e) => {
            if (!draggable) return;
            if (e.button !== 0) return;
            e.stopPropagation();
            e.preventDefault();
            const endDate = project.dueDate ? new Date(project.dueDate) : end;
            setDrag({
              projectId: project.id,
              startX: e.clientX,
              originalEnd: endDate,
              dxDays: 0,
              didMove: false,
            });
            try {
              (e.currentTarget as Element).setPointerCapture(e.pointerId);
            } catch {}
          }}
          onPointerMove={(e) => {
            if (!isDragging || pixelsPerDay <= 0) return;
            const px = e.clientX - drag!.startX;
            const days = Math.round(px / pixelsPerDay);
            if (days !== drag!.dxDays) {
              setDrag({ ...drag!, dxDays: days, didMove: true });
            }
          }}
          onPointerUp={async (e) => {
            if (!isDragging || !onReschedule) return;
            const moved = drag!.didMove && drag!.dxDays !== 0;
            const newDate = addDays(drag!.originalEnd, drag!.dxDays);
            const projId = drag!.projectId;
            try {
              (e.currentTarget as Element).releasePointerCapture(e.pointerId);
            } catch {}
            (e as unknown as { __justDragged?: boolean }).__justDragged = moved;
            setTimeout(() => setDrag(null), 0);
            if (moved) {
              await onReschedule(projId, newDate);
            }
          }}
          onClick={(e) => {
            // Bar is owned by the drag flow; never let the row's onClick fire.
            e.stopPropagation();
          }}
        >
          {/* Progress fill */}
          <div
            className={cn(
              "absolute inset-y-0 left-0",
              pc.solidBg,
              isCompleted ? "opacity-90" : "opacity-95",
              isDragging ? "" : "transition-[width] duration-300",
            )}
            style={{ width: `${Math.max(progress, 0)}%` }}
          />
          {/* Hatched remainder edge — subtle seam between fill + track */}
          {progress > 0 && progress < 100 && (
            <div
              className="absolute inset-y-0 w-px bg-foreground/20"
              style={{ left: `${progress}%` }}
            />
          )}

          {/* Bar label — sits above the fill */}
          <span
            className={cn(
              "relative z-10 px-2 text-[10px] font-semibold truncate",
              // Use solid-text colour where the fill is wide enough to sit
              // under the label; otherwise foreground reads on the track.
              progress >= 35 ? pc.solidText : "text-foreground",
            )}
          >
            {isDragging
              ? `→ ${format(previewDate!, "MMM d")}`
              : `${project.status.replace(/_/g, " ")} · ${progress}%`}
          </span>
        </div>

        {/* Overdue ring on bar — extra rose border if past due */}
        {isOverdue && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-7 rounded-md ring-2 ring-rose-500 ring-offset-1 ring-offset-background pointer-events-none"
            style={{
              left: `calc(${leftPct}% + 2px)`,
              width: `calc(${widthPct}% - 4px)`,
            }}
          />
        )}

        {/* Milestone diamond at the due/completion date (bar's right edge). */}
        {showDiamond && diamondAtRightEdge && (
          <div
            className="absolute top-1/2 pointer-events-none z-10"
            style={{ left: `calc(${leftPct + widthPct}% - 2px)` }}
            title={
              isCompleted
                ? "Completed"
                : isOverdue
                  ? "Due (overdue)"
                  : "Due date"
            }
          >
            <span
              className={cn(
                "block h-2.5 w-2.5 rotate-45 -translate-x-1/2 -translate-y-1/2 rounded-[2px] ring-2 ring-card shadow",
                isCompleted
                  ? "bg-emerald-500"
                  : isOverdue
                    ? "bg-rose-500"
                    : pc.dot,
              )}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Dependency arrows are rendered by the shared <DependencyArrows> overlay
// (components/schedule/dependency-arrows.tsx), measured from the live bar DOM
// nodes registered above. The same component powers the per-project task
// timeline, so the arrow look + elbow routing stay in lockstep.
