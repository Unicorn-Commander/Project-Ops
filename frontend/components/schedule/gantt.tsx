"use client";

/**
 * Gantt Schedule — custom-built around our existing project colour palette
 * so the schedule view is visually continuous with the kanban + dashboard.
 *
 * Design choices that matter:
 *
 *  - Timeline is N columns of equal width, each column = one ${zoomUnit}
 *    (week / month / quarter). Bars are positioned via CSS percentage,
 *    so resizing the viewport reflows naturally.
 *  - Each project bar uses `projectColorClasses(id).solidBg` so the
 *    schedule "rows" read with the same colour identity as kanban cards
 *    and dashboard rows.
 *  - "Today" is a vertical line spanning the body, dashed for distinction
 *    against the underlying month grid.
 *  - Filter sidebar is collapsible so the schedule can take full width
 *    when the operator wants the visual.
 *  - No drag-to-reschedule yet — the bar positions are read-only against
 *    `createdAt` + `dueDate`. Drag/resize is a follow-up that needs a
 *    PATCH route + an optimistic-update layer.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  CalendarRange,
} from "lucide-react";
import { projectColorClasses } from "@/lib/project-colors";
import { statusSolidClass } from "@/lib/badge-styles";

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
}

interface GanttProps {
  projects: ScheduleProject[];
}

// ─────────────────────────────────────────────────────────────────────────
// Zoom levels — each defines how much wall-clock time fits in the visible
// area. We always render NUM_COLS columns, just labelled differently.

const ZOOM_LEVELS = {
  "3-months":  { months: 3,  label: "3 months",  step: 1 }, // 12 weeks across
  "6-months":  { months: 6,  label: "6 months",  step: 1 }, // 6 months across
  "year":      { months: 12, label: "Year",      step: 1 }, // 12 months
  "18-months": { months: 18, label: "18 months", step: 2 }, // 9 columns of 2 months
} as const;

type ZoomKey = keyof typeof ZOOM_LEVELS;

// ─────────────────────────────────────────────────────────────────────────

export function Gantt({ projects }: GanttProps) {
  const router = useRouter();
  const [zoom, setZoom] = useState<ZoomKey>("6-months");
  const [anchorMonth, setAnchorMonth] = useState<Date>(() => startOfMonth(new Date()));

  // Filter state
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [filterPriority, setFilterPriority] = useState<string>("ALL");
  const [filterOrg, setFilterOrg] = useState<string>("ALL");
  const [showFilters, setShowFilters] = useState(true);

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

  // Compute bar positions for each visible project
  const rows = useMemo(() => {
    return filteredProjects
      .map((p) => {
        const start = startOfDay(new Date(p.createdAt));
        // If no due date, show as a 30-day bar from the start (gives visual presence
        // without faking commitment). If due is past, end at due. If completed,
        // end at completedAt.
        const explicitEnd = p.completedAt
          ? new Date(p.completedAt)
          : p.dueDate
            ? new Date(p.dueDate)
            : addMonths(start, 1);
        const end = startOfDay(explicitEnd);

        // Skip rows entirely outside the visible window
        const overlapStart = maxDate([start, windowStart]);
        const overlapEnd = minDate([end, windowEnd]);
        const visible = isAfter(overlapEnd, windowStart) && isBefore(overlapStart, windowEnd);

        const offsetDays = differenceInCalendarDays(maxDate([start, windowStart]), windowStart);
        const widthDays = Math.max(1, differenceInCalendarDays(minDate([end, windowEnd]), maxDate([start, windowStart])) + 1);

        return {
          project: p,
          start,
          end,
          visible,
          // Position as percent of total window width
          leftPct: (offsetDays / totalDays) * 100,
          widthPct: (widthDays / totalDays) * 100,
          // Whether the bar's true range extends beyond the visible window
          overflowLeft: isBefore(start, windowStart),
          overflowRight: isAfter(end, windowEnd),
        };
      })
      .filter((row) => row.visible);
  }, [filteredProjects, windowStart, windowEnd, totalDays]);

  // Today indicator
  const today = startOfDay(new Date());
  const todayInWindow = isWithinInterval(today, { start: windowStart, end: windowEnd });
  const todayPct = todayInWindow
    ? (differenceInCalendarDays(today, windowStart) / totalDays) * 100
    : null;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
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

          <div className="flex items-center gap-2">
            <Select value={zoom} onValueChange={(v) => setZoom(v as ZoomKey)}>
              <SelectTrigger className="w-[140px]">
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

      <Card className="overflow-hidden">
        {/* Header row — column labels */}
        <div className="flex border-b">
          <div className="shrink-0 w-[260px] px-4 py-3 border-r bg-muted/30">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Project
            </div>
          </div>
          <div className="relative flex-1 grid" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
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
        {rows.length === 0 ? (
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
          <div className="relative">
            {rows.map(({ project, leftPct, widthPct, overflowLeft, overflowRight, end }) => {
              const pc = projectColorClasses(project.id);
              const isCompleted = !!project.completedAt;
              const isOverdue = !isCompleted && project.dueDate && isAfter(today, new Date(project.dueDate));
              return (
                <div
                  key={project.id}
                  className="flex border-b last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer group"
                  onClick={() => router.push(`/dashboard/projects/${project.id}`)}
                >
                  <div className={`shrink-0 w-[260px] px-4 py-3 border-r flex items-center gap-2 border-l-4 ${pc.borderLeft} ${pc.cardWash}`}>
                    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium shrink-0 ${pc.badgeBg} ${pc.badgeText}`}>
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${pc.dot}`} />
                      {project.projectNumber.replace("PROJ-2026-", "P-")}
                    </span>
                    <span className="text-sm font-medium text-foreground truncate group-hover:underline">
                      {project.title}
                    </span>
                  </div>
                  <div
                    className="relative flex-1 grid h-12"
                    style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
                  >
                    {/* Column dividers — render as faint vertical lines */}
                    {columns.map((_, i) => (
                      <div key={i} className={`h-full ${i > 0 ? "border-l border-border/60" : ""}`} />
                    ))}

                    {/* The bar itself */}
                    <div
                      className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-md ${pc.solidBg} ${pc.solidText} flex items-center px-2 text-[10px] font-semibold shadow-sm transition-all group-hover:shadow-md ${isCompleted ? "opacity-60" : ""}`}
                      style={{
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        // If bar overflows the window edges, soften that side
                        clipPath:
                          overflowLeft && overflowRight
                            ? "polygon(8px 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0 50%)"
                            : overflowLeft
                              ? "polygon(8px 0, 100% 0, 100% 100%, 8px 100%, 0 50%)"
                              : overflowRight
                                ? "polygon(0 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 0 100%)"
                                : undefined,
                      }}
                      title={`${project.projectNumber} · ${project.title}\n${format(new Date(project.createdAt), "MMM d, yyyy")} → ${project.completedAt ? format(new Date(project.completedAt), "MMM d, yyyy") + " (completed)" : project.dueDate ? format(new Date(project.dueDate), "MMM d, yyyy") + (isOverdue ? " (overdue)" : "") : "ongoing"}`}
                    >
                      {/* Overlay status pill on the bar when there's room */}
                      <span className="truncate">
                        {project.status.replace(/_/g, " ")}
                      </span>
                    </div>

                    {/* Overdue ring on bar — extra red border if past due */}
                    {isOverdue && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 h-6 rounded-md ring-2 ring-rose-500 ring-offset-1 ring-offset-background pointer-events-none"
                        style={{
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}

            {/* Today vertical line — drawn over body rows so it shows through */}
            {todayPct !== null && (
              <div
                className="absolute top-0 bottom-0 pointer-events-none"
                style={{
                  // Position relative to the timeline area only — left column is 260px
                  left: `calc(260px + (100% - 260px) * ${todayPct} / 100)`,
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
            Showing {rows.length} of {filteredProjects.length} project{filteredProjects.length === 1 ? "" : "s"}{" "}
            in this window — {projects.length} total in scope.
          </span>
          <span className="hidden sm:inline">
            Click any row to open the project · Drag-to-reschedule coming next.
          </span>
        </div>
      </Card>
    </div>
  );
}
