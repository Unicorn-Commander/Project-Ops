"use client";

/**
 * Billing / invoicing — manager-only.
 *
 * RBAC: the backend `/billing/*` and `/billing-rates/*` controllers are
 * ADMIN/MANAGER only (class-level @Roles; STAFF/CLIENT get 403). We mirror
 * that here: non-managers see a "Managers only" empty state and nothing else.
 *
 * What this page does:
 *   1) Billable rollup preview — APPROVED + billable + UNBILLED time entries,
 *      summarised (count / hours / value) and grouped per project, each with a
 *      "Create draft invoice" action + a CSV export of the underlying rows.
 *   2) Create draft invoice (modal) — POST /billing/drafts. Handles BOTH the
 *      INVOICED and DRAFT_ONLY result variants; the UI works against the draft
 *      + rendered PDF regardless of Accounting-Ops status.
 *   3) Invoice / draft list — drafts+invoices created during THIS session
 *      (the backend has no "list invoices" GET in this module, so the list is
 *      in-memory only) + a "Sync invoice status" action that pulls AO payment
 *      status onto projects.
 *
 * Money note: entry `billableAmount` is a NUMBER; draft/invoice money fields
 * are decimal STRINGS. `formatMoney` tolerates both — use it everywhere.
 * We NEVER surface internal cost (the backend redacts it; we don't look).
 */

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/lib/store";
import { iconWellClass, paymentStatusBadgeClass } from "@/lib/badge-styles";
import { prettyEnum } from "@/lib/time-tracking-styles";
import { csvFilename, downloadCsv } from "@/lib/csv-export";
import { CreateDraftModal } from "@/components/time-tracking/create-draft-modal";
import {
  getTimeEntries,
  getProjectOptions,
  formatMoney,
  secondsToHours,
  syncInvoiceStatus,
  type TimeEntry,
  type ProjectOption,
  type BillableDraftResult,
} from "@/lib/time-tracking-api";
import {
  Receipt,
  FileText,
  FilePlus2,
  RefreshCw,
  Lock,
  AlertTriangle,
  Clock,
  DollarSign,
  ListChecks,
  ExternalLink,
  PlugZap,
  Loader2,
} from "lucide-react";

const ZINC_PILL = "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";

/** AO invoice `status` is a free string — map known PaymentStatus, else zinc. */
function aoStatusPillClass(status?: string): string {
  if (!status) return ZINC_PILL;
  return paymentStatusBadgeClass(status.toUpperCase());
}

/** A rollup row: one project's approved+billable+unbilled time. */
interface ProjectRollup {
  projectId: string;
  projectNumber: string;
  title: string;
  currency: string;
  entryCount: number;
  hours: number;
  value: number;
}

/** A created result + a stable client id + when it happened (for the list). */
interface SessionInvoice {
  key: string;
  createdAt: number;
  result: BillableDraftResult;
}

export default function BillingPage() {
  const { user } = useAuthStore();
  const isManager = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { toast } = useToast();

  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalProjectId, setModalProjectId] = useState<string | undefined>(undefined);

  const [sessionInvoices, setSessionInvoices] = useState<SessionInvoice[]>([]);
  const [syncing, setSyncing] = useState(false);

  const fetchRollup = async () => {
    setLoading(true);
    setError(false);
    try {
      // Approved + billable + unbilled = what's ready to invoice. The project
      // options feed the create-draft picker (independent, best-effort).
      const [page, projectOpts] = await Promise.all([
        getTimeEntries({
          approvalStatus: "APPROVED",
          billable: true,
          billed: false,
          limit: 200,
        }),
        getProjectOptions().catch(() => [] as ProjectOption[]),
      ]);
      setEntries(page.data ?? []);
      setProjects(projectOpts);
    } catch {
      setError(true);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isManager) {
      setLoading(false);
      return;
    }
    fetchRollup();
  }, [isManager]);

  // Summary + per-project rollup, derived from the loaded entries.
  const { totalHours, totalValue, currency, rollups } = useMemo(() => {
    const byProject = new Map<string, ProjectRollup>();
    let hours = 0;
    let value = 0;
    let cur = "USD";

    for (const e of entries) {
      const secs = e.roundingAppliedSeconds ?? e.durationSeconds ?? 0;
      const h = secondsToHours(secs);
      const amt = e.billableAmount ?? 0;
      hours += h;
      value += amt;
      if (e.currency) cur = e.currency;

      const pid = e.project?.id ?? e.projectId;
      const existing = byProject.get(pid);
      if (existing) {
        existing.entryCount += 1;
        existing.hours += h;
        existing.value += amt;
      } else {
        byProject.set(pid, {
          projectId: pid,
          projectNumber: e.project?.projectNumber ?? "—",
          title: e.project?.title ?? "Untitled project",
          currency: e.currency || "USD",
          entryCount: 1,
          hours: h,
          value: amt,
        });
      }
    }

    const rows = Array.from(byProject.values()).sort((a, b) => b.value - a.value);
    return {
      totalHours: Math.round(hours * 100) / 100,
      totalValue: value,
      currency: cur,
      rollups: rows,
    };
  }, [entries]);

  const openCreateModal = (projectId?: string) => {
    setModalProjectId(projectId);
    setModalOpen(true);
  };

  const handleCreated = (result: BillableDraftResult) => {
    setSessionInvoices((prev) => [
      { key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), result },
      ...prev,
    ]);
    // The entries just billed will drop out of the rollup on next refresh.
    fetchRollup();
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { synced } = await syncInvoiceStatus();
      toast({
        title: "Invoice status synced",
        description:
          synced === 0
            ? "No invoice payment changes from Accounting-Ops."
            : `Pulled payment status for ${synced} invoice${synced === 1 ? "" : "s"} from Accounting-Ops.`,
      });
    } catch (e: any) {
      toast({
        title: "Couldn't sync invoice status",
        description:
          e?.response?.data?.message ||
          "Accounting-Ops may be unreachable. Try again shortly.",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const exportRollupCsv = () => {
    const header = [
      "Date",
      "User",
      "Project",
      "Task",
      "Description",
      "Hours",
      "Bill Rate",
      "Amount",
      "Currency",
    ];
    const rows: Array<Array<unknown>> = [header];
    for (const e of entries) {
      const secs = e.roundingAppliedSeconds ?? e.durationSeconds ?? 0;
      rows.push([
        e.startedAt ? new Date(e.startedAt).toISOString().slice(0, 10) : "",
        e.userId,
        e.project ? `${e.project.projectNumber} — ${e.project.title}` : e.projectId,
        e.task?.title ?? "",
        e.description ?? "",
        secondsToHours(secs),
        e.billRateApplied ?? "",
        e.billableAmount ?? "",
        e.currency || "USD",
      ]);
    }
    downloadCsv(csvFilename("billable-rollup"), rows);
  };

  // ----- Non-manager guard ---------------------------------------------------
  if (!isManager) {
    return (
      <div className="po-page-enter space-y-6">
        <EmptyState
          icon={Lock}
          iconTone="amber"
          title="Managers only"
          body="Billing and invoicing are restricted to admins and managers. If you think you should have access, ask a workspace admin to update your role."
        />
      </div>
    );
  }

  // ----- Loading -------------------------------------------------------------
  if (loading) {
    return (
      <div className="po-page-enter space-y-6">
        <Skeleton className="h-4 w-72" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
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
          {[1, 2, 3].map((i) => (
            <SkeletonText key={i} lines={2} />
          ))}
        </Card>
      </div>
    );
  }

  return (
    <>
      <CreateDraftModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        projects={projects}
        preselectedProjectId={modalProjectId}
        onCreated={handleCreated}
      />

      <div className="po-page-enter space-y-6">
        {/* Header — title lives in the top bar; subtitle + actions only. */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Roll up approved, billable time into draft invoices and track their
            status. Manager &amp; admin only.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              {syncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              {syncing ? "Syncing…" : "Sync invoice status"}
            </Button>
            <Button onClick={() => openCreateModal(undefined)}>
              <FilePlus2 className="mr-2 h-4 w-4" />
              Create invoice
            </Button>
          </div>
        </div>

        {/* ---- Error state (rollup fetch) ---- */}
        {error ? (
          <Card className="p-6">
            <EmptyState
              icon={AlertTriangle}
              iconTone="rose"
              title="Couldn't load the billable rollup"
              body="Something went wrong fetching approved billable time. Check your connection and try again."
              action={
                <Button variant="outline" onClick={fetchRollup}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Retry
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {/* ---- Summary stat cards ---- */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Billable entries
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
                      {entries.length}
                    </p>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass("blue")}`}>
                    <ListChecks className="h-5 w-5" />
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Billable hours
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
                      {totalHours}
                    </p>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass("amber")}`}>
                    <Clock className="h-5 w-5" />
                  </div>
                </div>
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Billable value
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
                      {formatMoney(totalValue, currency)}
                    </p>
                  </div>
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconWellClass("emerald")}`}>
                    <DollarSign className="h-5 w-5" />
                  </div>
                </div>
              </Card>
            </div>

            {/* ---- Per-project rollup ---- */}
            <Card className="p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Ready to bill</h2>
                  <p className="text-sm text-muted-foreground">
                    Approved, billable, not-yet-invoiced time grouped by project.
                  </p>
                </div>
                {entries.length > 0 && (
                  <Button variant="outline" size="sm" onClick={exportRollupCsv}>
                    <FileText className="mr-2 h-4 w-4" />
                    Export CSV
                  </Button>
                )}
              </div>

              {rollups.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  iconTone="zinc"
                  title="Nothing ready to bill"
                  body="Approve some billable time first — approved, billable, not-yet-invoiced entries will appear here grouped by project."
                />
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">Project</th>
                        <th className="px-4 py-2.5 text-right font-medium">Entries</th>
                        <th className="px-4 py-2.5 text-right font-medium">Hours</th>
                        <th className="px-4 py-2.5 text-right font-medium">Value</th>
                        <th className="px-4 py-2.5 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rollups.map((r) => (
                        <tr key={r.projectId} className="border-b border-border last:border-0">
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="font-mono text-xs text-muted-foreground">
                                {r.projectNumber}
                              </span>
                              <span className="font-medium text-foreground">{r.title}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">
                            {r.entryCount}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums">
                            {Math.round(r.hours * 100) / 100}
                          </td>
                          <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">
                            {formatMoney(r.value, r.currency)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openCreateModal(r.projectId)}
                            >
                              <FilePlus2 className="mr-2 h-3.5 w-3.5" />
                              Create draft invoice
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        )}

        {/* ---- Invoices / drafts created this session ---- */}
        <Card className="p-6">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">Invoices &amp; drafts</h2>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Reflects invoices and drafts created in this session. A persistent
            invoice history isn&apos;t available yet (no backend list endpoint
            for this module).
          </p>

          {sessionInvoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              iconTone="zinc"
              title="No invoices yet this session"
              body="Create a draft invoice from a project in the rollup above, or use “Create invoice”. Issued and draft invoices will be listed here."
              action={
                <Button variant="outline" onClick={() => openCreateModal(undefined)}>
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  Create invoice
                </Button>
              }
            />
          ) : (
            <div className="space-y-3">
              {sessionInvoices.map((item) => {
                const { result } = item;
                const draft = result.draft;
                const isInvoiced = result.status === "INVOICED";
                const label = isInvoiced
                  ? result.invoice.invoiceNumber ||
                    result.invoice.externalRef ||
                    "Invoice"
                  : result.externalRef || "Draft";
                const statusText = isInvoiced
                  ? result.invoice.status
                    ? prettyEnum(result.invoice.status)
                    : "Invoiced"
                  : "Draft only";
                const statusClass = isInvoiced
                  ? aoStatusPillClass(result.invoice.status)
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300";
                const totalDisplay = isInvoiced
                  ? formatMoney(result.invoice.total ?? draft.total, draft.currency)
                  : formatMoney(draft.total, draft.currency);

                return (
                  <div
                    key={item.key}
                    className="rounded-md border border-border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-foreground">{label}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass}`}
                        >
                          {statusText}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums text-sm font-semibold text-foreground">
                        {totalDisplay}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {draft.entryCount} entr{draft.entryCount === 1 ? "y" : "ies"}
                      </span>
                      <span>
                        {draft.lineItems.length} line item
                        {draft.lineItems.length === 1 ? "" : "s"}
                      </span>
                      {result.unpricedCount > 0 && (
                        <span className="text-orange-600 dark:text-orange-400">
                          {result.unpricedCount} unpriced skipped
                        </span>
                      )}
                      <span>{new Date(item.createdAt).toLocaleString()}</span>
                    </div>

                    {/* DRAFT_ONLY reason hint */}
                    {!isInvoiced && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        <PlugZap className="h-3.5 w-3.5" />
                        {result.message} — connect Accounting-Ops to issue this invoice.
                      </p>
                    )}

                    {result.previewUrl && (
                      <a
                        href={result.previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                      >
                        <FileText className="h-4 w-4" />
                        {isInvoiced ? "View / download PDF" : "View draft PDF"}
                        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
