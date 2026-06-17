"use client";

/**
 * Weekly timesheet — two modes by role.
 *
 *  1. "My timesheet" (all non-CLIENT roles): a Mon..Sun × project grid of the
 *     signed-in user's tracked hours for the selected week, with a per-cell
 *     adjust editor (while the week is still all-DRAFT/unlocked) and a
 *     Submit-week action that rolls the week's draft entries into a period.
 *
 *  2. "Approvals" (ADMIN/MANAGER only): the SUBMITTED queue, grouped by user +
 *     timesheet period, each group approvable/rejectable in one action.
 *
 * RBAC mirrors the backend: CLIENTs can't log time (read-only message); only
 * managers see the approval queue, and approve/reject are 403-guarded
 * server-side regardless. Editability of a cell follows the same rule the
 * Time-entries page uses (DRAFT + unlocked + unbilled).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  startOfWeek,
  endOfWeek,
  addDays,
  addWeeks,
  format,
  parseISO,
  isSameDay,
} from "date-fns";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { iconWellClass } from "@/lib/badge-styles";
import { approvalBadgeClass, billableBadgeClass } from "@/lib/time-tracking-styles";
import { useAuthStore } from "@/lib/store";
import {
  getTimeEntries,
  createTimeEntry,
  updateTimeEntry,
  submitTimesheet,
  approveTime,
  rejectTime,
  getUserOptions,
  userLabel,
  secondsToHours,
  type TimeEntry,
  type UserOption,
} from "@/lib/time-tracking-api";
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  Send,
  Loader2,
  X,
  Check,
  CalendarClock,
  CheckCircle2,
  Users,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Small date helpers (local-time; the backend computes week bounds in UTC but
// only needs `periodStart` to land inside the target week, and from/to filter
// on startedAt — passing the local week edges is what every sibling does).
// ---------------------------------------------------------------------------

const WEEK_OPTS = { weekStartsOn: 1 as const }; // Monday — matches WEEK_START_DAY.

/** The seven Date objects Mon..Sun for the week containing `anchor`. */
function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor, WEEK_OPTS);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Human label for the week range, e.g. "Jun 16 – Jun 22, 2026". */
function weekRangeLabel(anchor: Date): string {
  const start = startOfWeek(anchor, WEEK_OPTS);
  const end = endOfWeek(anchor, WEEK_OPTS);
  return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

/** Sum of the rounding-applied (fallback duration) hours on a single entry. */
function entryHours(e: TimeEntry): number {
  return secondsToHours(e.roundingAppliedSeconds ?? e.durationSeconds);
}

const HOURS_FMT = (n: number) => (n === 0 ? "–" : n.toFixed(2));

type Tab = "mine" | "approvals";

// ===========================================================================
// Page
// ===========================================================================

export default function TimesheetsPage() {
  const { user } = useAuthStore();

  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isClient = user?.role === "CLIENT";

  const [tab, setTab] = useState<Tab>("mine");

  // The auth store hydrates after first paint; until we know the user, show a
  // skeleton rather than firing requests with an undefined userId.
  if (!user) {
    return <TimesheetSkeleton />;
  }

  return (
    <div className="po-page-enter space-y-6">
      {/* Header — page title lives in the top bar; subtitle + tabs only. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {isClient
            ? "Timesheets for the people working on your projects."
            : "Review your week, adjust hours, and submit for approval."}
        </p>
        {isManager && (
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            {(
              [
                { key: "mine", label: "My timesheet" },
                { key: "approvals", label: "Approvals" },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  tab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {isManager && tab === "approvals" ? (
        <ApprovalQueue />
      ) : isClient ? (
        <Card className="p-6">
          <EmptyState
            icon={Clock}
            iconTone="violet"
            title="No timesheet to fill in"
            body="Time is logged by the team working on your projects. You don't track time here."
          />
        </Card>
      ) : (
        <MyTimesheet userId={user.id} />
      )}
    </div>
  );
}

// ===========================================================================
// Mode 1 — My weekly timesheet
// ===========================================================================

interface CellEdit {
  projectId: string;
  projectLabel: string;
  day: Date;
  /** The single DRAFT entry in this cell, if exactly one — otherwise null. */
  entry: TimeEntry | null;
  currentHours: number;
}

function MyTimesheet({ userId }: { userId: string }) {
  const { toast } = useToast();

  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [edit, setEdit] = useState<CellEdit | null>(null);

  const days = useMemo(() => weekDays(anchor), [anchor]);
  const weekStart = days[0];

  const fetchWeek = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // from/to filter on startedAt; cover the full last day with end-of-week.
      const res = await getTimeEntries({
        userId,
        from: startOfWeek(anchor, WEEK_OPTS).toISOString(),
        to: endOfWeek(anchor, WEEK_OPTS).toISOString(),
        limit: 200,
      });
      setEntries(res.data ?? []);
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
          "Failed to load this week's time. Please try again.",
      );
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [anchor, userId]);

  useEffect(() => {
    void fetchWeek();
  }, [fetchWeek]);

  // --- Grouping: project rows × day columns -------------------------------

  const projects = useMemo(() => {
    const seen = new Map<string, { id: string; label: string }>();
    entries.forEach((e) => {
      if (e.project?.id && !seen.has(e.project.id)) {
        seen.set(e.project.id, {
          id: e.project.id,
          label: `${e.project.projectNumber} — ${e.project.title}`,
        });
      }
    });
    return Array.from(seen.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [entries]);

  /** entries for a given project on a given local day. */
  const cellEntries = useCallback(
    (projectId: string, day: Date): TimeEntry[] =>
      entries.filter(
        (e) =>
          e.projectId === projectId && isSameDay(parseISO(e.startedAt), day),
      ),
    [entries],
  );

  const cellHours = useCallback(
    (projectId: string, day: Date): number => {
      const sum = cellEntries(projectId, day).reduce(
        (acc, e) => acc + entryHours(e),
        0,
      );
      return Math.round(sum * 100) / 100;
    },
    [cellEntries],
  );

  // --- Week status / editability ------------------------------------------

  const draftEntries = useMemo(
    () => entries.filter((e) => e.approvalStatus === "DRAFT"),
    [entries],
  );

  // The week is editable only while EVERY entry is DRAFT and none locked/billed
  // (mirrors the Time-entries page's canEdit rule). An empty week is editable
  // so a fresh week can be populated.
  const weekEditable = useMemo(
    () =>
      entries.every(
        (e) => e.approvalStatus === "DRAFT" && !e.lockedAt && !e.billed,
      ),
    [entries],
  );

  const statusSummary = useMemo(() => {
    const acc = { draft: 0, submitted: 0, approved: 0, rejected: 0, total: 0 };
    entries.forEach((e) => {
      const h = entryHours(e);
      acc.total += h;
      if (e.approvalStatus === "DRAFT") acc.draft += h;
      else if (e.approvalStatus === "SUBMITTED") acc.submitted += h;
      else if (e.approvalStatus === "APPROVED") acc.approved += h;
      else if (e.approvalStatus === "REJECTED") acc.rejected += h;
    });
    (Object.keys(acc) as (keyof typeof acc)[]).forEach((k) => {
      acc[k] = Math.round(acc[k] * 100) / 100;
    });
    return acc;
  }, [entries]);

  const dayTotals = useMemo(
    () =>
      days.map((d) =>
        Math.round(
          projects.reduce((acc, p) => acc + cellHours(p.id, d), 0) * 100,
        ) / 100,
      ),
    [days, projects, cellHours],
  );

  const projectTotals = useMemo(
    () =>
      projects.map((p) =>
        Math.round(
          days.reduce((acc, d) => acc + cellHours(p.id, d), 0) * 100,
        ) / 100,
      ),
    [days, projects, cellHours],
  );

  const grandTotal = useMemo(
    () => Math.round(dayTotals.reduce((a, b) => a + b, 0) * 100) / 100,
    [dayTotals],
  );

  // --- Actions -------------------------------------------------------------

  const openCell = (project: { id: string; label: string }, day: Date) => {
    if (!weekEditable) return;
    const inCell = cellEntries(project.id, day);
    if (inCell.length > 1) return; // multi-entry cells are read-only.
    setEdit({
      projectId: project.id,
      projectLabel: project.label,
      day,
      entry: inCell[0] ?? null,
      currentHours: cellHours(project.id, day),
    });
  };

  const handleSaveCell = async (hours: number) => {
    if (!edit) return;
    const minutes = Math.max(0, Math.round(hours * 60));
    try {
      if (edit.entry) {
        await updateTimeEntry(edit.entry.id, { durationMinutes: minutes });
      } else {
        // New entry: start at 09:00 local on the chosen day.
        const start = new Date(edit.day);
        start.setHours(9, 0, 0, 0);
        await createTimeEntry({
          projectId: edit.projectId,
          startedAt: start.toISOString(),
          durationMinutes: minutes,
        });
      }
      toast({ title: "Hours updated" });
      setEdit(null);
      void fetchWeek();
    } catch (e: any) {
      toast({
        title: "Couldn't save hours",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const period = await submitTimesheet(weekStart.toISOString());
      toast({
        title: "Timesheet submitted",
        description: `Submitted ${period.entryCount ?? 0} ${
          period.entryCount === 1 ? "entry" : "entries"
        } for approval.`,
      });
      void fetchWeek();
    } catch (e: any) {
      toast({
        title: "Couldn't submit timesheet",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // --- Render --------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Cell editor modal */}
      {edit && (
        <AdjustHoursModal
          edit={edit}
          onClose={() => setEdit(null)}
          onSave={handleSaveCell}
        />
      )}

      {/* Week navigator + submit */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => setAnchor((d) => addWeeks(d, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnchor(new Date())}
          >
            This week
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next week"
            onClick={() => setAnchor((d) => addWeeks(d, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-semibold text-foreground">
            {weekRangeLabel(anchor)}
          </span>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={submitting || draftEntries.length === 0 || !weekEditable}
        >
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          Submit week
        </Button>
      </div>

      {/* Status banner */}
      {!loading && !error && entries.length > 0 && (
        <Card
          className={`p-4 ${
            weekEditable
              ? ""
              : "border-amber-500/40 bg-amber-500/10 dark:border-amber-500/30"
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass(
                  weekEditable ? "blue" : "amber",
                )}`}
              >
                {weekEditable ? (
                  <CalendarClock className="h-5 w-5" />
                ) : (
                  <CheckCircle2 className="h-5 w-5" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {weekEditable
                    ? `${grandTotal.toFixed(2)} h this week`
                    : "Submitted — awaiting approval"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {weekEditable
                    ? "Click a cell to adjust hours, then submit the week."
                    : "This week's entries are locked while under review."}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <StatusChip status="DRAFT" hours={statusSummary.draft} />
              <StatusChip status="SUBMITTED" hours={statusSummary.submitted} />
              <StatusChip status="APPROVED" hours={statusSummary.approved} />
              {statusSummary.rejected > 0 && (
                <StatusChip status="REJECTED" hours={statusSummary.rejected} />
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Grid / states */}
      {loading ? (
        <GridSkeleton />
      ) : error ? (
        <Card className="p-6">
          <EmptyState
            icon={Clock}
            iconTone="rose"
            title="Couldn't load this week"
            body={error}
            action={
              <Button variant="outline" onClick={() => void fetchWeek()}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : projects.length === 0 ? (
        <Card className="p-6">
          <EmptyState
            icon={Clock}
            iconTone="violet"
            title="No time logged this week"
            body="Log time from the Time entries page or start a timer in the top bar — it'll show up here as a weekly grid you can adjust and submit."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">Project</th>
                  {days.map((d) => (
                    <th
                      key={d.toISOString()}
                      className="px-3 py-3 text-center font-semibold"
                    >
                      <div>{format(d, "EEE")}</div>
                      <div className="font-normal normal-case text-muted-foreground/70">
                        {format(d, "M/d")}
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p, rowIdx) => (
                  <tr
                    key={p.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="max-w-[14rem] px-4 py-3 align-top">
                      <span className="line-clamp-2 font-medium text-foreground">
                        {p.label}
                      </span>
                    </td>
                    {days.map((d) => {
                      const hrs = cellHours(p.id, d);
                      const inCell = cellEntries(p.id, d);
                      const multiple = inCell.length > 1;
                      const clickable = weekEditable && !multiple;
                      return (
                        <td
                          key={d.toISOString()}
                          className="px-1.5 py-1.5 text-center"
                        >
                          <button
                            type="button"
                            disabled={!clickable}
                            onClick={() => openCell(p, d)}
                            title={
                              multiple
                                ? "Multiple entries — edit on the Time entries page"
                                : clickable
                                  ? "Adjust hours"
                                  : undefined
                            }
                            className={`w-full rounded-md px-2 py-2 font-mono tabular-nums transition-colors ${
                              hrs === 0
                                ? "text-muted-foreground/50"
                                : "text-foreground"
                            } ${
                              clickable
                                ? "hover:bg-primary/10 hover:text-primary cursor-pointer"
                                : "cursor-default"
                            }`}
                          >
                            {HOURS_FMT(hrs)}
                            {multiple && (
                              <span className="ml-0.5 align-super text-[9px] text-muted-foreground">
                                ×{inCell.length}
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                    <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold text-foreground">
                      {projectTotals[rowIdx].toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/40 text-sm">
                  <td className="px-4 py-3 font-semibold text-muted-foreground">
                    Total
                  </td>
                  {dayTotals.map((t, i) => (
                    <td
                      key={i}
                      className="px-3 py-3 text-center font-mono tabular-nums font-semibold text-foreground"
                    >
                      {HOURS_FMT(t)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-bold text-foreground">
                    {grandTotal.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {entries.some((e) => cellEntries(e.projectId, parseISO(e.startedAt)).length > 1) && (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Cells with multiple entries (×N) are read-only here — edit them on
              the Time entries page.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Adjust-hours modal (overlay-Card pattern, matching create-task-modal)
// ---------------------------------------------------------------------------

function AdjustHoursModal({
  edit,
  onClose,
  onSave,
}: {
  edit: CellEdit;
  onClose: () => void;
  onSave: (hours: number) => Promise<void>;
}) {
  const [value, setValue] = useState<string>(
    edit.currentHours ? String(edit.currentHours) : "",
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const submit = async () => {
    const hours = Number(value);
    if (Number.isNaN(hours) || hours < 0) return;
    setSaving(true);
    try {
      await onSave(hours);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="mx-4 w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Adjust hours</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {edit.projectLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              {format(edit.day, "EEEE, MMM d")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={onClose}
            className="h-8 w-8 p-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="adjust-hours">Hours</Label>
          <Input
            id="adjust-hours"
            type="number"
            min={0}
            step={0.25}
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="0.00"
            className="font-mono tabular-nums"
          />
          <p className="text-xs text-muted-foreground">
            {edit.entry
              ? "Updates the existing entry's duration for this day."
              : "Creates a new entry at 9:00 AM on this day."}
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save hours"
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function StatusChip({ status, hours }: { status: string; hours: number }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${approvalBadgeClass(
        status,
      )}`}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
      <span className="font-mono tabular-nums">{hours.toFixed(2)}h</span>
    </span>
  );
}

// ===========================================================================
// Mode 2 — Manager approval queue
// ===========================================================================

interface ApprovalGroup {
  key: string;
  userId: string;
  timesheetPeriodId: string | null;
  entries: TimeEntry[];
  rangeStart: Date;
  rangeEnd: Date;
  totalHours: number;
  billableHours: number;
}

function ApprovalQueue() {
  const { toast } = useToast();

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [users, setUsers] = useState<Record<string, UserOption>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalGroup | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, userOpts] = await Promise.all([
        getTimeEntries({ approvalStatus: "SUBMITTED", limit: 200 }),
        getUserOptions().catch(() => [] as UserOption[]),
      ]);
      setEntries(res.data ?? []);
      const map: Record<string, UserOption> = {};
      userOpts.forEach((u) => {
        map[u.id] = u;
      });
      setUsers(map);
    } catch (e: any) {
      setError(
        e?.response?.data?.message ||
          "Failed to load the approval queue. Please try again.",
      );
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchQueue();
  }, [fetchQueue]);

  // Group by user, then by timesheet period (entries without a period are
  // grouped under a synthetic "loose" bucket per user so they can still be
  // approved/rejected by id).
  const groups = useMemo<ApprovalGroup[]>(() => {
    const byKey = new Map<string, TimeEntry[]>();
    entries.forEach((e) => {
      const periodKey = e.timesheetPeriodId ?? "loose";
      const key = `${e.userId}::${periodKey}`;
      const arr = byKey.get(key) ?? [];
      arr.push(e);
      byKey.set(key, arr);
    });

    return Array.from(byKey.entries())
      .map(([key, list]) => {
        const times = list.map((e) => parseISO(e.startedAt).getTime());
        const totalHours =
          Math.round(list.reduce((acc, e) => acc + entryHours(e), 0) * 100) /
          100;
        const billableHours =
          Math.round(
            list
              .filter((e) => e.billable)
              .reduce((acc, e) => acc + entryHours(e), 0) * 100,
          ) / 100;
        return {
          key,
          userId: list[0].userId,
          timesheetPeriodId: list[0].timesheetPeriodId,
          entries: [...list].sort(
            (a, b) =>
              parseISO(a.startedAt).getTime() - parseISO(b.startedAt).getTime(),
          ),
          rangeStart: new Date(Math.min(...times)),
          rangeEnd: new Date(Math.max(...times)),
          totalHours,
          billableHours,
        };
      })
      .sort((a, b) => b.rangeStart.getTime() - a.rangeStart.getTime());
  }, [entries]);

  const nameFor = (userId: string): string => {
    const u = users[userId];
    return u ? userLabel(u) : `User ${userId.slice(0, 8)}`;
  };

  const handleApprove = async (group: ApprovalGroup) => {
    setPendingKey(group.key);
    try {
      const res = await approveTime(
        group.timesheetPeriodId
          ? { timesheetPeriodId: group.timesheetPeriodId }
          : { timeEntryIds: group.entries.map((e) => e.id) },
      );
      toast({
        title: "Approved",
        description: `${res.approved} ${
          res.approved === 1 ? "entry" : "entries"
        } approved.`,
      });
      void fetchQueue();
    } catch (e: any) {
      toast({
        title: "Couldn't approve",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingKey(null);
    }
  };

  const handleReject = async (group: ApprovalGroup, reason: string) => {
    setPendingKey(group.key);
    try {
      const res = await rejectTime(
        group.timesheetPeriodId
          ? { timesheetPeriodId: group.timesheetPeriodId, reason }
          : { timeEntryIds: group.entries.map((e) => e.id), reason },
      );
      toast({
        title: "Rejected",
        description: `${res.rejected} ${
          res.rejected === 1 ? "entry" : "entries"
        } sent back.`,
      });
      setRejecting(null);
      void fetchQueue();
    } catch (e: any) {
      toast({
        title: "Couldn't reject",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPendingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2].map((i) => (
          <Card key={i} className="space-y-3 p-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-40" />
            </div>
            {[1, 2, 3].map((j) => (
              <Skeleton key={j} className="h-9 w-full" />
            ))}
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={Users}
          iconTone="rose"
          title="Couldn't load approvals"
          body={error}
          action={
            <Button variant="outline" onClick={() => void fetchQueue()}>
              Try again
            </Button>
          }
        />
      </Card>
    );
  }

  if (groups.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState
          icon={CheckCircle2}
          iconTone="emerald"
          title="No timesheets awaiting approval"
          body="When team members submit their weeks, they'll appear here for you to approve or send back."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {rejecting && (
        <RejectModal
          group={rejecting}
          userName={nameFor(rejecting.userId)}
          pending={pendingKey === rejecting.key}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => handleReject(rejecting, reason)}
        />
      )}

      {groups.map((group) => {
        const busy = pendingKey === group.key;
        return (
          <Card key={group.key} className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass(
                    "blue",
                  )}`}
                >
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    {nameFor(group.userId)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format(group.rangeStart, "MMM d")} –{" "}
                    {format(group.rangeEnd, "MMM d, yyyy")} ·{" "}
                    {group.entries.length}{" "}
                    {group.entries.length === 1 ? "entry" : "entries"}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono tabular-nums font-semibold text-foreground">
                      {group.totalHours.toFixed(2)} h
                    </span>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${billableBadgeClass(
                        true,
                      )}`}
                    >
                      {group.billableHours.toFixed(2)} h billable
                    </span>
                    {!group.timesheetPeriodId && (
                      <span className="text-[10px] text-muted-foreground/70">
                        loose entries
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRejecting(group)}
                  className="text-rose-600 hover:text-rose-700 dark:text-rose-400"
                >
                  <X className="mr-1.5 h-4 w-4" />
                  Reject
                </Button>
                <Button size="sm" disabled={busy} onClick={() => handleApprove(group)}>
                  {busy ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1.5 h-4 w-4" />
                  )}
                  Approve
                </Button>
              </div>
            </div>

            {/* Entry preview */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2 font-semibold">Date</th>
                    <th className="px-4 py-2 font-semibold">Project</th>
                    <th className="px-4 py-2 font-semibold">Description</th>
                    <th className="px-4 py-2 text-right font-semibold">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {group.entries.map((e) => (
                    <tr
                      key={e.id}
                      className="border-b border-border/40 last:border-0"
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                        {format(parseISO(e.startedAt), "EEE, MMM d")}
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-medium text-foreground">
                          {e.project?.projectNumber}
                        </span>
                        <span className="ml-1 text-xs text-muted-foreground">
                          {e.task?.title ?? e.project?.title}
                        </span>
                      </td>
                      <td className="max-w-[18rem] px-4 py-2">
                        <span className="line-clamp-1 text-muted-foreground">
                          {e.description || "—"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right font-mono tabular-nums text-foreground">
                        {entryHours(e).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reject-reason modal (reason required)
// ---------------------------------------------------------------------------

function RejectModal({
  group,
  userName,
  pending,
  onClose,
  onConfirm,
}: {
  group: ApprovalGroup;
  userName: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const trimmed = reason.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Card className="mx-4 w-full max-w-md p-6 animate-in zoom-in-95 duration-200">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">
              Reject timesheet
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {userName} · {group.totalHours.toFixed(2)} h
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={onClose}
            className="h-8 w-8 p-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          <Label htmlFor="reject-reason">
            Reason <span className="text-rose-500">*</span>
          </Label>
          <Textarea
            id="reject-reason"
            rows={3}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Let them know what to fix before resubmitting…"
          />
          <p className="text-xs text-muted-foreground">
            The submitter sees this when their entries are sent back to draft.
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || trimmed.length === 0}
            onClick={() => onConfirm(trimmed)}
          >
            {pending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Rejecting…
              </>
            ) : (
              "Reject timesheet"
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ===========================================================================
// Skeletons
// ===========================================================================

function GridSkeleton() {
  return (
    <Card className="overflow-hidden p-6">
      <div className="space-y-3">
        <div className="flex gap-2">
          <Skeleton className="h-4 w-40" />
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-8" />
            ))}
          </div>
        </div>
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Card>
  );
}

function TimesheetSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-72" />
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-9 w-32" />
      </div>
      <GridSkeleton />
    </div>
  );
}
