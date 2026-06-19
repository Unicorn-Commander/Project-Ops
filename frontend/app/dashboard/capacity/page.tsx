"use client";

/**
 * Capacity / resource-planning board.
 *
 * Two postures off one shared report shape:
 *   - ADMIN/MANAGER  → the TEAM view (GET /capacity): every member's committed
 *     hours vs pro-rated capacity, sorted most-loaded first, with a totals
 *     rollup, a committed-vs-capacity chart, and an inline capacity editor.
 *   - STAFF/CLIENT   → their OWN workload (GET /capacity/me): a single row, no
 *     editor, no team chart. The team endpoint 403s them, so if we ever call it
 *     for a non-manager we fall back to /me and, failing that, an access state.
 *
 * RBAC gating: the edit affordance + the team fetch are gated on the auth
 * store's `user.role`, read AFTER hydration (never in a useState initializer /
 * during render). The backend independently enforces both — this is a UX gate,
 * not the security boundary.
 *
 * Recharts usage (CapacityChart) mirrors `components/dashboard/project-charts.tsx`
 * exactly (numeric ResponsiveContainer height, isAnimationActive={false}).
 *
 * Hydration (React #418): the default date window is the CURRENT week, computed
 * in an effect — never `new Date()` in render — and all role-dependent UI is
 * gated behind `useHydrated()`, so the server render and first client render
 * agree.
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  startOfWeek,
  endOfWeek,
  addWeeks,
  startOfDay,
  endOfDay,
  format,
} from "date-fns";
import {
  Users,
  Clock,
  Gauge,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  ArrowUpDown,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpHint } from "@/components/guidance";
import { useToast } from "@/components/ui/use-toast";
import { iconWellClass } from "@/lib/badge-styles";
import { useAuthStore } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import {
  getTeamCapacity,
  getMyCapacity,
  fmtHours,
  type CapacityReport,
  type UserCapacityRow,
} from "@/lib/capacity-api";
import { WorkloadRow } from "@/components/capacity/workload-row";
import { CapacityChart } from "@/components/capacity/capacity-chart";
import { EditCapacityDialog } from "@/components/capacity/edit-capacity-dialog";

// ---------------------------------------------------------------------------
// Week navigation. The window is a Mon→Sun week; `weekOffset` is relative to
// the current week (0 = this week, -1 = last week, +1 = next week). The actual
// dates are derived in an effect-safe way from a base `today` that we only read
// after mount, so render never touches `new Date()`.
// ---------------------------------------------------------------------------

interface Win {
  from: string; // ISO, Mon 00:00
  to: string; // ISO, Sun 23:59:59.999
  label: string;
}

function weekWindow(today: Date, weekOffset: number): Win {
  const base = addWeeks(today, weekOffset);
  const from = startOfDay(startOfWeek(base, { weekStartsOn: 1 }));
  const to = endOfDay(endOfWeek(base, { weekStartsOn: 1 }));
  const label = `${format(from, "MMM d")} – ${format(to, "MMM d")}`;
  return { from: from.toISOString(), to: to.toISOString(), label };
}

type Mode = "team" | "me";

// Every hint on this surface deep-links to the one capacity explainer.
const CAPACITY_HELP = {
  category: "capacity",
  article: "capacity-overview",
} as const;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CapacityPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const hydrated = useHydrated();

  // Role is only trustworthy after hydration (store rehydrates client-side).
  const role = hydrated ? user?.role : undefined;
  const isManager = role === "ADMIN" || role === "MANAGER";

  // Week navigation — `today` is set once on mount (NOT in render).
  const [today, setToday] = useState<Date | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  useEffect(() => {
    setToday(new Date());
  }, []);

  const win = useMemo(
    () => (today ? weekWindow(today, weekOffset) : null),
    [today, weekOffset],
  );

  const [report, setReport] = useState<CapacityReport | null>(null);
  const [mode, setMode] = useState<Mode>("team");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  // Edit dialog state (team mode only).
  const [editRow, setEditRow] = useState<UserCapacityRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const isForbidden = (err: unknown): boolean =>
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    (err as { response?: { status?: number } }).response?.status === 403;

  const fetchData = useCallback(async () => {
    // Wait for hydration (role + window) before the first fetch.
    if (!hydrated || !win) return;
    setLoading(true);
    setError(false);
    setForbidden(false);
    const params = { from: win.from, to: win.to };

    try {
      if (isManager) {
        // Managers get the team view; on the off chance of a 403 (role drift
        // between store + server), gracefully fall back to the personal view.
        try {
          const data = await getTeamCapacity(params);
          setReport(data);
          setMode("team");
        } catch (err) {
          if (isForbidden(err)) {
            const mine = await getMyCapacity(params);
            setReport(mine);
            setMode("me");
          } else {
            throw err;
          }
        }
      } else {
        const mine = await getMyCapacity(params);
        setReport(mine);
        setMode("me");
      }
    } catch (err) {
      if (isForbidden(err)) {
        setForbidden(true);
      } else {
        console.error("Error loading capacity:", err);
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }, [hydrated, win, isManager]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRetry = () => {
    toast({ title: "Retrying", description: "Reloading capacity data…" });
    void fetchData();
  };

  const openEdit = (row: UserCapacityRow) => {
    setEditRow(row);
    setEditOpen(true);
  };

  // Rows already arrive sorted most-loaded-first from the server; keep that.
  const rows = report?.users ?? [];
  const totals = report?.totals;
  const showTeamChrome = mode === "team";

  // -------------------------------------------------------------------------
  // Loading skeleton (also covers pre-hydration so SSR + first paint match).
  // -------------------------------------------------------------------------
  if (!hydrated || loading) {
    return (
      <div className="po-page-enter space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
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
        <Card className="space-y-3 p-6">
          <Skeleton className="h-5 w-40" />
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Forbidden — no team access and (somehow) no personal row either.
  // -------------------------------------------------------------------------
  if (forbidden) {
    return (
      <div className="po-page-enter space-y-6">
        <Header
          win={win}
          weekOffset={weekOffset}
          onPrev={() => setWeekOffset((o) => o - 1)}
          onNext={() => setWeekOffset((o) => o + 1)}
          onThisWeek={() => setWeekOffset(0)}
          mode={mode}
        />
        <Card className="p-6">
          <EmptyState
            icon={Users}
            iconTone="amber"
            title="You don’t have access to the team view"
            body="Capacity planning across the team is available to admins and managers. Ask a workspace admin if you need access."
          />
        </Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error
  // -------------------------------------------------------------------------
  if (error) {
    return (
      <div className="po-page-enter space-y-6">
        <Header
          win={win}
          weekOffset={weekOffset}
          onPrev={() => setWeekOffset((o) => o - 1)}
          onNext={() => setWeekOffset((o) => o + 1)}
          onThisWeek={() => setWeekOffset(0)}
          mode={mode}
        />
        <Card className="p-6">
          <EmptyState
            icon={AlertTriangle}
            iconTone="rose"
            title="Couldn’t load capacity"
            body="Something went wrong fetching the resource-planning data. Check your connection and try again."
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

  const hasRows = rows.length > 0;

  // -------------------------------------------------------------------------
  // Loaded
  // -------------------------------------------------------------------------
  return (
    <div className="po-page-enter space-y-6">
      <Header
        win={win}
        weekOffset={weekOffset}
        onPrev={() => setWeekOffset((o) => o - 1)}
        onNext={() => setWeekOffset((o) => o + 1)}
        onThisWeek={() => setWeekOffset(0)}
        mode={mode}
      />

      {/* Totals tiles (team) or a single personal summary (me). */}
      {showTeamChrome && totals ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Team capacity"
            value={fmtHours(totals.capacityHours)}
            tone="blue"
            icon={Clock}
          />
          <StatCard
            label="Committed"
            value={fmtHours(totals.committedHours)}
            tone="violet"
            icon={CalendarRange}
            help={
              <HelpHint learnMore={CAPACITY_HELP}>
                Total estimated hours on every assigned task in this window. Tasks with no
                estimate aren&apos;t counted here — the &quot;unestimated&quot; warning flags
                them so this total isn&apos;t quietly understating the real load.
              </HelpHint>
            }
            hint={
              totals.unestimatedCount > 0
                ? `${totals.unestimatedCount} unestimated task${
                    totals.unestimatedCount === 1 ? "" : "s"
                  }`
                : undefined
            }
          />
          <StatCard
            label="Overall utilization"
            value={`${Math.round(totals.utilizationPct)}%`}
            tone={
              totals.utilizationPct > 100
                ? "rose"
                : totals.utilizationPct >= 85
                  ? "amber"
                  : "emerald"
            }
            icon={Gauge}
          />
          <StatCard
            label="Over-allocated"
            value={String(totals.overAllocatedCount)}
            tone={totals.overAllocatedCount > 0 ? "rose" : "emerald"}
            icon={AlertTriangle}
            hint={
              totals.overAllocatedCount > 0
                ? `of ${rows.length} ${rows.length === 1 ? "person" : "people"}`
                : "everyone within capacity"
            }
          />
        </div>
      ) : (
        rows[0] && <PersonalSummary row={rows[0]} />
      )}

      {/* Committed-vs-capacity chart (team only — a single row isn't a chart). */}
      {showTeamChrome && hasRows && <CapacityChart rows={rows} />}

      {/* The board itself */}
      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Users className="h-4 w-4 text-muted-foreground" />
              {showTeamChrome ? "Team workload" : "Your workload"}
            </h3>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {showTeamChrome ? (
                <>
                  <ArrowUpDown className="h-3 w-3" />
                  Sorted by utilization, most-loaded first
                </>
              ) : (
                "Your committed hours against your available capacity this week"
              )}
            </p>
          </div>
          {showTeamChrome && hasRows && <LoadLegend />}
        </div>

        {hasRows ? (
          <div className="space-y-2">
            {rows.map((row) => (
              <WorkloadRow
                key={row.userId}
                row={row}
                // Manager-only edit affordance — gated on role, enforced server-side.
                onEdit={showTeamChrome && isManager ? openEdit : undefined}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            iconTone="zinc"
            title={
              showTeamChrome ? "No active members yet" : "No workload this week"
            }
            body={
              showTeamChrome
                ? "Once people join this workspace and pick up tasks, their load will show here."
                : "You have no in-window assigned tasks. Pick up a task or adjust the week to see your load."
            }
          />
        )}
      </Card>

      {/* Edit-capacity dialog — only mounted for managers in team mode. */}
      {showTeamChrome && isManager && win && (
        <EditCapacityDialog
          row={editRow}
          windowDays={report?.windowDays ?? 7}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSaved={() => {
            void fetchData();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({
  win,
  weekOffset,
  onPrev,
  onNext,
  onThisWeek,
  mode,
}: {
  win: Win | null;
  weekOffset: number;
  onPrev: () => void;
  onNext: () => void;
  onThisWeek: () => void;
  mode: Mode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {mode === "team"
          ? "Who’s over-committed and who has headroom — committed task hours against capacity."
          : "Your committed task hours against your available capacity."}
        <HelpHint icon="info" side="right" learnMore={CAPACITY_HELP}>
          Capacity planning stacks each person&apos;s{" "}
          <span className="font-semibold">committed</span> hours (the estimates on the tasks
          assigned to them) against their <span className="font-semibold">capacity</span> for
          the window (their weekly hours, pro-rated). It&apos;s driven by task estimates, so
          unestimated work is flagged rather than silently uncounted.
        </HelpHint>
      </p>
      <div className="inline-flex items-center gap-2">
        <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onPrev}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[8.5rem] px-2 text-center text-xs font-medium tabular-nums text-foreground">
            {win?.label ?? "—"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onNext}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onThisWeek}
          disabled={weekOffset === 0}
          className="h-9"
        >
          This week
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  icon: Icon,
  hint,
  help,
}: {
  label: string;
  value: string;
  tone: Parameters<typeof iconWellClass>[0];
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  /** Optional guidance affordance (a <HelpHint>) shown after the label. */
  help?: React.ReactNode;
}) {
  return (
    <Card className="p-4 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            {label}
            {help}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
            {value}
          </p>
          {hint && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {hint}
            </p>
          )}
        </div>
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            iconWellClass(tone),
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

/** The personal summary shown to non-managers in place of team totals. */
function PersonalSummary({ row }: { row: UserCapacityRow }) {
  const overTone = row.overAllocated
    ? "rose"
    : row.utilizationPct >= 85
      ? "amber"
      : "emerald";
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Your capacity"
        value={fmtHours(row.capacityHours)}
        tone="blue"
        icon={Clock}
      />
      <StatCard
        label="Committed"
        value={fmtHours(row.committedHours)}
        tone="violet"
        icon={CalendarRange}
        hint={`${row.taskCount} ${row.taskCount === 1 ? "task" : "tasks"}`}
      />
      <StatCard
        label="Utilization"
        value={`${Math.round(row.utilizationPct)}%`}
        tone={overTone}
        icon={Gauge}
      />
      <StatCard
        label="Unestimated"
        value={String(row.unestimatedCount)}
        tone={row.unestimatedCount > 0 ? "amber" : "emerald"}
        icon={AlertTriangle}
        help={
          <HelpHint learnMore={CAPACITY_HELP}>
            Assigned tasks with no time estimate. They don&apos;t add to your committed hours,
            so your load could really be higher than it looks. Add an estimate on each to make
            the picture accurate.
          </HelpHint>
        }
        hint={
          row.unestimatedCount > 0
            ? "tasks without an estimate"
            : "all tasks estimated"
        }
      />
    </div>
  );
}

/** Colour key for the load bands. */
function LoadLegend() {
  const items: { tone: string; label: string }[] = [
    { tone: "bg-emerald-500", label: "<85%" },
    { tone: "bg-amber-500", label: "85–100%" },
    { tone: "bg-rose-500", label: ">100%" },
  ];
  return (
    <div className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:flex">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={cn("inline-block h-2 w-2 rounded-sm", it.tone)} />
          <span className="text-muted-foreground">{it.label}</span>
        </span>
      ))}
      <HelpHint learnMore={CAPACITY_HELP}>
        Utilization is committed ÷ capacity. The bands read at a glance:{" "}
        <span className="font-semibold text-emerald-600 dark:text-emerald-400">green</span> is
        comfortable headroom (under 85%),{" "}
        <span className="font-semibold text-amber-600 dark:text-amber-400">amber</span> is at
        risk (85–100%), and{" "}
        <span className="font-semibold text-rose-600 dark:text-rose-400">red</span> means
        over-allocated (past 100% — committed beyond capacity).
      </HelpHint>
    </div>
  );
}
