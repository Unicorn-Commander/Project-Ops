"use client";

/**
 * Create a billable draft invoice. Matches the app's overlay-Card modal
 * pattern (see components/modals/create-task-modal.tsx).
 *
 * Flow: pick a project (clientId is supported by the API but v1 surfaces
 * project selection only) + optional period + groupBy, then POST
 * /billing/drafts via `createBillableDraft`. The endpoint is MANAGER/ADMIN
 * only on the backend.
 *
 * The result is a UNION the caller must handle two ways:
 *   - INVOICED   → Accounting-Ops issued a real invoice (show invoice + PDF).
 *   - DRAFT_ONLY → AO not connected/entitled/reachable; we STILL rendered a
 *                  draft PDF + assembled line items. This is NOT an error —
 *                  the UI works against the draft regardless of AO status.
 *
 * Money / quantity fields on the draft + invoice are decimal STRINGS — always
 * pipe through `formatMoney` (which tolerates both numbers and strings).
 */

import { useEffect, useState } from "react";
import { Loader2, FileText, ExternalLink, AlertTriangle, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { ProjectPicker } from "@/components/time-tracking/entity-pickers";
import { prettyEnum } from "@/lib/time-tracking-styles";
import { paymentStatusBadgeClass } from "@/lib/badge-styles";
import {
  createBillableDraft,
  formatMoney,
  type BillableGroupBy,
  type BillableDraftResult,
  type ProjectOption,
} from "@/lib/time-tracking-api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Project options for the picker (loaded once by the parent). */
  projects: ProjectOption[];
  /** Pre-seed the project (e.g. "Create draft" from a rollup row). */
  preselectedProjectId?: string;
  /** Bubble the created result up so the parent can add it to the list. */
  onCreated: (result: BillableDraftResult) => void;
}

const GROUP_BY_OPTIONS: { value: BillableGroupBy; label: string }[] = [
  { value: "TASK", label: "By task" },
  { value: "ROLE", label: "By role" },
  { value: "DAY", label: "By day" },
  { value: "NONE", label: "No grouping (one line)" },
];

const ZINC_PILL = "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";

/** AO invoice `status` is a free string — map known PaymentStatus, else zinc. */
function aoStatusPillClass(status?: string): string {
  if (!status) return ZINC_PILL;
  const known = paymentStatusBadgeClass(status.toUpperCase());
  // paymentStatusBadgeClass falls back to zinc for unknown keys; that's fine.
  return known;
}

export function CreateDraftModal({
  isOpen,
  onClose,
  projects,
  preselectedProjectId,
  onCreated,
}: Props) {
  const { toast } = useToast();

  const [projectId, setProjectId] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [groupBy, setGroupBy] = useState<BillableGroupBy>("TASK");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BillableDraftResult | null>(null);

  // Seed / reset fields whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setProjectId(preselectedProjectId ?? "");
    setPeriodStart("");
    setPeriodEnd("");
    setGroupBy("TASK");
    setResult(null);
    setSubmitting(false);
  }, [isOpen, preselectedProjectId]);

  const canSubmit = !!projectId && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // periodStart/End are <input type=date> values ("YYYY-MM-DD"); the API
      // accepts ISO — a bare date is a valid ISO calendar date.
      const res = await createBillableDraft({
        projectId,
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined,
        groupBy,
      });
      setResult(res);
      onCreated(res);

      if (res.status === "INVOICED") {
        toast({
          title: "Invoice created",
          description: res.invoice.invoiceNumber
            ? `Invoice ${res.invoice.invoiceNumber} issued via Accounting-Ops.`
            : "Issued via Accounting-Ops.",
        });
      } else {
        // DRAFT_ONLY is informational, not a failure.
        toast({
          title: "Draft created",
          description: res.message || "Accounting-Ops is not connected — draft saved.",
        });
      }
    } catch (e: any) {
      toast({
        title: "Couldn't create draft",
        description:
          e?.response?.data?.message ||
          "Please check the project and period, then try again.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const draft = result?.draft;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        overlayClassName="bg-black/50 backdrop-blur-sm"
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-card"
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Create draft invoice</DialogTitle>
          <DialogDescription>
            Rolls up approved, billable, unbilled time into a draft. If
            Accounting-Ops is connected it issues a real invoice; otherwise
            you still get a draft PDF.
          </DialogDescription>
        </DialogHeader>

        {/* --- Form (hidden once we have a result, to focus on the outcome) --- */}
        {!result && (
          <div className="space-y-4">
            <div>
              <Label className="mb-1.5 block">Project</Label>
              {projects.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  No projects available to bill against.
                </p>
              ) : (
                <ProjectPicker
                  projects={projects}
                  value={projectId}
                  onChange={setProjectId}
                  disabled={!!preselectedProjectId}
                  placeholder="Select a project to bill"
                />
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="draft-period-start" className="mb-1.5 block">
                  Period start (optional)
                </Label>
                <Input
                  id="draft-period-start"
                  type="date"
                  value={periodStart}
                  max={periodEnd || undefined}
                  onChange={(e) => setPeriodStart(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="draft-period-end" className="mb-1.5 block">
                  Period end (optional)
                </Label>
                <Input
                  id="draft-period-end"
                  type="date"
                  value={periodEnd}
                  min={periodStart || undefined}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="draft-groupby" className="mb-1.5 block">
                Group line items
              </Label>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as BillableGroupBy)}>
                <SelectTrigger id="draft-groupby">
                  <SelectValue placeholder="By task" />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_BY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-xs text-muted-foreground">
              Only approved, billable, not-yet-billed entries are included.
              Entries with no resolved bill rate are skipped.
            </p>
          </div>
        )}

        {/* --- Result --- */}
        {result && draft && (
          <div className="space-y-5">
            {/* Outcome banner */}
            {result.status === "INVOICED" ? (
              <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                    <span className="font-semibold text-foreground">
                      {result.invoice.invoiceNumber || result.invoice.externalRef || "Invoice issued"}
                    </span>
                    {result.invoice.status && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${aoStatusPillClass(
                          result.invoice.status,
                        )}`}
                      >
                        {prettyEnum(result.invoice.status)}
                      </span>
                    )}
                  </div>
                  <span className="font-mono tabular-nums text-sm font-semibold text-foreground">
                    {formatMoney(result.invoice.total ?? draft.total, draft.currency)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-emerald-700/80 dark:text-emerald-300/80">
                  Issued via Accounting-Ops.
                  {result.invoice.balanceDue != null && (
                    <>
                      {" "}Balance due{" "}
                      <span className="font-mono tabular-nums">
                        {formatMoney(result.invoice.balanceDue, draft.currency)}
                      </span>
                      .
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-300" />
                  <div className="flex-1">
                    <p className="font-semibold text-foreground">
                      Draft saved — not invoiced ({prettyEnum(result.reason)})
                    </p>
                    <p className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
                      {result.message}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-200">
                      <PlugZap className="h-3.5 w-3.5" />
                      Connect Accounting-Ops to issue this invoice.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* PDF link — present for BOTH variants */}
            {result.previewUrl && (
              <a
                href={result.previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <FileText className="h-4 w-4" />
                {result.status === "INVOICED" ? "View / download PDF" : "View draft PDF"}
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </a>
            )}

            {/* Unpriced warning */}
            {result.unpricedCount > 0 && (
              <p className="rounded-md border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-700 dark:text-orange-300">
                {result.unpricedCount} entr{result.unpricedCount === 1 ? "y" : "ies"} had
                no resolved bill rate and {result.unpricedCount === 1 ? "was" : "were"}{" "}
                skipped.
              </p>
            )}

            {/* Line items */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">
                  Line items ({draft.lineItems.length})
                </h3>
                <span className="text-xs text-muted-foreground">
                  {draft.entryCount} entr{draft.entryCount === 1 ? "y" : "ies"} rolled up
                </span>
              </div>
              {draft.lineItems.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
                  No priced line items were produced for this selection.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 text-right font-medium">Unit price</th>
                        <th className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {draft.lineItems.map((line, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 text-foreground">{line.description}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {Number(line.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatMoney(line.unitPrice, draft.currency)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {formatMoney(line.amount, draft.currency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-muted/40">
                        <td className="px-3 py-2 text-xs font-semibold text-muted-foreground" colSpan={3}>
                          Total
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-foreground">
                          {formatMoney(draft.total, draft.currency)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* --- Footer --- */}
        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
          {result ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={!canSubmit}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Create draft"
                )}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
