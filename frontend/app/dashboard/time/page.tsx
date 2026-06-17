"use client";

/**
 * Time entries — list + manual log + edit + delete.
 *
 * RBAC mirrors the backend: any non-CLIENT member can log/edit their own
 * entries; ADMIN/MANAGER see and can edit everyone's. The list endpoint is
 * already visibility-scoped server-side, so "My time" is a client filter on
 * top of what the API returns. Edit/Delete are only offered on DRAFT, unlocked,
 * unbilled entries (the backend rejects anything else with 403).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { ListToolbar, FilterOption } from "@/components/ui/list-toolbar";
import { iconWellClass } from "@/lib/badge-styles";
import {
  approvalBadgeClass,
  billableBadgeClass,
  sourceBadgeClass,
  prettyEnum,
} from "@/lib/time-tracking-styles";
import { useAuthStore } from "@/lib/store";
import { useTimer } from "@/components/time-tracking/timer-provider";
import { TimeEntryModal } from "@/components/time-tracking/time-entry-modal";
import {
  getTimeEntries,
  deleteTimeEntry,
  exportTimeEntriesCsv,
  downloadCsvText,
  formatMoney,
  secondsToHours,
  type TimeEntry,
  type ApprovalStatus,
} from "@/lib/time-tracking-api";
import {
  Plus,
  Clock,
  Pencil,
  Trash2,
  Download,
  Square,
  Loader2,
  Timer as TimerIcon,
} from "lucide-react";

const APPROVAL_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All statuses" },
  { value: "DRAFT", label: "Draft", dot: "bg-zinc-400" },
  { value: "SUBMITTED", label: "Submitted", dot: "bg-amber-500" },
  { value: "APPROVED", label: "Approved", dot: "bg-emerald-500" },
  { value: "REJECTED", label: "Rejected", dot: "bg-rose-500" },
];

const BILLABLE_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "Billable & non" },
  { value: "billable", label: "Billable only", dot: "bg-emerald-500" },
  { value: "non", label: "Non-billable", dot: "bg-zinc-400" },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TimeEntriesPage() {
  const { user } = useAuthStore();
  const { toast } = useToast();
  const { running, refresh: refreshTimer, stop } = useTimer();
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";
  const isClient = user?.role === "CLIENT";

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [filterApproval, setFilterApproval] = useState<ApprovalStatus | "ALL">("ALL");
  const [filterBillable, setFilterBillable] = useState<"ALL" | "billable" | "non">("ALL");
  const [filterProject, setFilterProject] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = { limit: 200, page: 1 };
      if (filterApproval !== "ALL") params.approvalStatus = filterApproval;
      if (filterBillable !== "ALL") params.billable = filterBillable === "billable";
      if (scope === "mine" && user?.id) params.userId = user.id;
      const res = await getTimeEntries(params);
      setEntries(res.data ?? []);
    } catch (e: any) {
      setError(
        e?.response?.data?.message || "Failed to load time entries. Please try again.",
      );
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [filterApproval, filterBillable, scope, user?.id]);

  useEffect(() => {
    void fetchEntries();
  }, [fetchEntries]);

  // Project filter options derived from loaded rows (no extra round-trip).
  const projectOptions: FilterOption[] = useMemo(() => {
    const seen = new Map<string, string>();
    entries.forEach((e) => {
      if (e.project?.id) {
        seen.set(e.project.id, `${e.project.projectNumber} — ${e.project.title}`);
      }
    });
    return [
      { value: "ALL", label: "All projects" },
      ...Array.from(seen.entries()).map(([value, label]) => ({ value, label })),
    ];
  }, [entries]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterProject !== "ALL" && e.project?.id !== filterProject) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          e.description?.toLowerCase().includes(q) ||
          e.project?.projectNumber?.toLowerCase().includes(q) ||
          e.project?.title?.toLowerCase().includes(q) ||
          e.task?.title?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [entries, filterProject, search]);

  const totals = useMemo(() => {
    let hours = 0;
    let billableHours = 0;
    let amount = 0;
    filtered.forEach((e) => {
      const h = secondsToHours(e.roundingAppliedSeconds ?? e.durationSeconds);
      hours += h;
      if (e.billable) billableHours += h;
      if (e.billableAmount) amount += e.billableAmount;
    });
    return {
      hours: Math.round(hours * 100) / 100,
      billableHours: Math.round(billableHours * 100) / 100,
      amount,
    };
  }, [filtered]);

  const canEdit = (e: TimeEntry): boolean =>
    !e.billed &&
    !e.lockedAt &&
    e.approvalStatus === "DRAFT" &&
    (isManager || e.userId === user?.id);

  const handleDelete = async (e: TimeEntry) => {
    if (!window.confirm("Delete this time entry? This cannot be undone.")) return;
    setDeletingId(e.id);
    try {
      await deleteTimeEntry(e.id);
      toast({ title: "Entry deleted" });
      void fetchEntries();
    } catch (err: any) {
      toast({
        title: "Couldn't delete entry",
        description: err?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await exportTimeEntriesCsv(
        filterProject !== "ALL" ? { projectId: filterProject } : undefined,
      );
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsvText(`time-entries-${stamp}.csv`, csv);
    } catch (e: any) {
      toast({
        title: "Export failed",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleStopRunning = async () => {
    setStopping(true);
    try {
      await stop();
      toast({ title: "Timer stopped" });
      void fetchEntries();
    } catch (e: any) {
      toast({
        title: "Couldn't stop timer",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setStopping(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-4">
              <Skeleton className="mb-2 h-3 w-24" />
              <Skeleton className="h-7 w-16" />
            </Card>
          ))}
        </div>
        <Card className="space-y-3 p-6">
          <Skeleton className="h-5 w-40" />
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </Card>
      </div>
    );
  }

  return (
    <>
      <TimeEntryModal
        isOpen={modalOpen}
        entry={editing}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSuccess={() => {
          void fetchEntries();
          void refreshTimer();
        }}
      />

      <div className="po-page-enter space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {isClient
              ? "Time logged against your projects."
              : "Your tracked time — log entries manually or start a timer from the top bar."}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export CSV
            </Button>
            {!isClient && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setModalOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" />
                Log time
              </Button>
            )}
          </div>
        </div>

        {/* Running-timer banner (in sync with the chrome widget) */}
        {running && (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-emerald-500/40 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">
                  Timer running on {running.project?.projectNumber ?? "a project"}
                  {running.task ? ` · ${running.task.title}` : ""}
                </p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-300/80">
                  Started {fmtTime(running.startedAt)} — see the live clock in the top bar.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleStopRunning}
              disabled={stopping}
              className="border-emerald-500/40"
            >
              {stopping ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Square className="mr-2 h-4 w-4 fill-current" />
              )}
              Stop &amp; log
            </Button>
          </Card>
        )}

        {/* Summary stats */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Total hours</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{totals.hours}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass("blue")}`}>
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Billable hours</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{totals.billableHours}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass("emerald")}`}>
                <TimerIcon className="h-5 w-5" />
              </div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Billable value</p>
                <p className="mt-1 text-2xl font-bold text-foreground">
                  {totals.amount ? formatMoney(totals.amount) : "—"}
                </p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass("violet")}`}>
                <Download className="h-5 w-5" />
              </div>
            </div>
          </Card>
        </div>

        {/* Manager-only scope toggle: my time vs everyone's. */}
        {isManager && (
          <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded px-3 py-1.5 font-medium transition-colors ${
                  scope === s
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "mine" ? "My time" : "Everyone"}
              </button>
            ))}
          </div>
        )}

        {/* Toolbar */}
        <ListToolbar
          search={{ value: search, onChange: setSearch, placeholder: "Search entries…" }}
          filters={[
            {
              key: "approval",
              label: "Status",
              value: filterApproval,
              onChange: (v: string) => setFilterApproval(v as ApprovalStatus | "ALL"),
              options: APPROVAL_OPTIONS,
            },
            {
              key: "billable",
              label: "Billable",
              value: filterBillable,
              onChange: (v: string) => setFilterBillable(v as "ALL" | "billable" | "non"),
              options: BILLABLE_OPTIONS,
            },
            {
              key: "project",
              label: "Project",
              value: filterProject,
              onChange: setFilterProject,
              options: projectOptions,
              hidden: projectOptions.length <= 1,
            },
          ]}
        />

        {error ? (
          <Card className="p-6">
            <EmptyState
              icon={Clock}
              iconTone="rose"
              title="Couldn't load time entries"
              body={error}
              action={
                <Button variant="outline" onClick={() => void fetchEntries()}>
                  Try again
                </Button>
              }
            />
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="p-6">
            <EmptyState
              icon={Clock}
              iconTone="violet"
              title="No time entries yet"
              body={
                search || filterApproval !== "ALL" || filterBillable !== "ALL"
                  ? "No entries match your filters."
                  : isClient
                    ? "No time has been logged against your projects yet."
                    : "Log time manually or start a timer from the top bar."
              }
              action={
                !isClient && !(search || filterApproval !== "ALL") ? (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setModalOpen(true);
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Log time
                  </Button>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Project / task</th>
                    <th className="px-4 py-3 font-semibold">Description</th>
                    <th className="px-4 py-3 text-right font-semibold">Hours</th>
                    <th className="px-4 py-3 text-right font-semibold">Rate</th>
                    <th className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th className="px-4 py-3 font-semibold">Billable</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => {
                    const hours = secondsToHours(e.roundingAppliedSeconds ?? e.durationSeconds);
                    const editable = canEdit(e);
                    return (
                      <tr
                        key={e.id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          <div className="font-medium text-foreground">{fmtDate(e.startedAt)}</div>
                          <div className="text-xs">{fmtTime(e.startedAt)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">
                            {e.project?.projectNumber}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {e.task?.title ?? e.project?.title}
                          </div>
                        </td>
                        <td className="max-w-[16rem] px-4 py-3">
                          <span className="line-clamp-2 text-muted-foreground">
                            {e.description || "—"}
                          </span>
                          <span
                            className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${sourceBadgeClass(e.source)}`}
                          >
                            {prettyEnum(e.source)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-foreground">
                          {e.endedAt ? hours.toFixed(2) : "running"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {e.billRateApplied != null
                            ? formatMoney(e.billRateApplied, e.currency)
                            : "—"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-foreground">
                          {e.billableAmount != null
                            ? formatMoney(e.billableAmount, e.currency)
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${billableBadgeClass(e.billable)}`}
                          >
                            {e.billable ? "Billable" : "Non-billable"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${approvalBadgeClass(e.approvalStatus)}`}
                          >
                            {prettyEnum(e.approvalStatus)}
                          </span>
                          {e.billed && (
                            <span className="ml-1 inline-flex items-center rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300">
                              Billed
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {editable ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  aria-label="Edit entry"
                                  onClick={() => {
                                    setEditing(e);
                                    setModalOpen(true);
                                  }}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 dark:text-rose-400"
                                  aria-label="Delete entry"
                                  disabled={deletingId === e.id}
                                  onClick={() => handleDelete(e)}
                                >
                                  {deletingId === e.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground/60">Locked</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Showing {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          {scope === "mine" && isManager ? " (your time)" : ""}. Entries are
          editable while in Draft; once submitted or billed they lock.
        </p>
      </div>
    </>
  );
}
