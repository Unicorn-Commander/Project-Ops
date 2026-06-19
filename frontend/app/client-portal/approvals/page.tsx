"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  MessageSquareWarning,
  ClipboardCheck,
  FileText,
  Package,
  FolderKanban,
  ShieldCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import { format } from "date-fns";
import Link from "next/link";
import { PortalPageHeader, PortalEmpty } from "@/components/portal";
import {
  getApprovals,
  decideApproval,
  approvalStatusLabel,
  approvalStatusBadgeClass,
  entityTypeLabel,
  type PortalApproval,
  type ApprovalDecision,
  type ApprovalEntityType,
} from "@/lib/portal-api";

const ENTITY_ICON: Record<ApprovalEntityType, typeof FileText> = {
  DOCUMENT: FileText,
  DELIVERABLE: Package,
  PROJECT: FolderKanban,
};

/** A single decision a client can take, with its presentation + plain-language
 *  "what happens next" so the choice never feels consequential-but-unclear. */
const DECISIONS: Array<{
  value: ApprovalDecision;
  label: string;
  icon: typeof CheckCircle2;
  className: string;
}> = [
  {
    value: "APPROVED",
    label: "Approve",
    icon: CheckCircle2,
    className:
      "bg-emerald-600 text-white hover:bg-emerald-600/90 focus-visible:ring-emerald-600",
  },
  {
    value: "CHANGES_REQUESTED",
    label: "Request changes",
    icon: MessageSquareWarning,
    className:
      "bg-violet-600 text-white hover:bg-violet-600/90 focus-visible:ring-violet-600",
  },
  {
    value: "REJECTED",
    label: "Reject",
    icon: XCircle,
    className:
      "bg-rose-600 text-white hover:bg-rose-600/90 focus-visible:ring-rose-600",
  },
];

export default function ClientApprovalsPage() {
  const { toast } = useToast();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState<PortalApproval[]>([]);

  // Per-row in-flight decision state. Keyed by approval id; holds the optional
  // note draft and which decision (if any) is currently submitting.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<Record<string, ApprovalDecision | null>>(
    {}
  );

  useEffect(() => {
    loadApprovals();
  }, []);

  const loadApprovals = async () => {
    try {
      setLoading(true);
      const res = await getApprovals();
      setApprovals(res.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to load approvals",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const { pending, decided } = useMemo(() => {
    const pending_: PortalApproval[] = [];
    const decided_: PortalApproval[] = [];
    for (const a of approvals) {
      (a.status === "PENDING" ? pending_ : decided_).push(a);
    }
    return { pending: pending_, decided: decided_ };
  }, [approvals]);

  const handleDecide = async (approval: PortalApproval, decision: ApprovalDecision) => {
    setSubmitting((s) => ({ ...s, [approval.id]: decision }));
    try {
      const note = notes[approval.id]?.trim() || undefined;
      const updated = await decideApproval(approval.id, { decision, note });
      // Replace the row in place so it moves from "pending" into history.
      setApprovals((rows) =>
        rows.map((r) => (r.id === updated.id ? updated : r))
      );
      setNotes((n) => {
        const next = { ...n };
        delete next[approval.id];
        return next;
      });
      toast({
        title: approvalStatusLabel(decision),
        description: "Your decision has been recorded.",
      });
    } catch (error: any) {
      toast({
        title: "Could not record decision",
        description:
          error.response?.data?.message ||
          "This approval may have already been decided. Refresh and try again.",
        variant: "destructive",
      });
      // Re-sync so a stale row (already decided elsewhere) corrects itself.
      loadApprovals();
    } finally {
      setSubmitting((s) => ({ ...s, [approval.id]: null }));
    }
  };

  const renderEntity = (approval: PortalApproval) => {
    const Icon = ENTITY_ICON[approval.entityType] ?? FileText;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <Icon className="h-4 w-4 text-primary" />
          {entityTypeLabel(approval.entityType)}
        </span>
        {approval.project && (
          <>
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
            <Link
              href={`/client-portal/projects/${approval.project.id}`}
              className="text-primary hover:underline"
            >
              {approval.project.title}{" "}
              <span className="font-mono text-xs text-muted-foreground">
                #{approval.project.projectNumber}
              </span>
            </Link>
          </>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PortalPageHeader
        icon={ClipboardCheck}
        title="Approvals"
        subtitle="When your team sends work for sign-off, it lands here. Take your time — nothing changes until you decide."
      />

      {/* Pending — needs your action */}
      <section aria-labelledby="pending-heading" className="space-y-4">
        <div className="flex items-center gap-2.5">
          <h2 id="pending-heading" className="text-lg font-bold text-foreground">
            Waiting on you
          </h2>
          {pending.length > 0 && (
            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
              {pending.length}
            </Badge>
          )}
        </div>

        {pending.length === 0 ? (
          <PortalEmpty
            icon={CheckCircle2}
            iconTone="emerald"
            title="You're all caught up"
            body="Nothing is waiting for your approval right now. When your team shares something for sign-off, you'll find it here."
          />
        ) : (
          <>
            {/* A calm, reassuring preamble so the section never feels like a
                pile of obligations. */}
            <div className="flex items-start gap-3 rounded-xl border border-border bg-primary/[0.04] px-4 py-3 text-sm text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p>
                Review each item below, then choose to{" "}
                <span className="font-medium text-foreground">approve</span>,{" "}
                <span className="font-medium text-foreground">request changes</span>, or{" "}
                <span className="font-medium text-foreground">reject</span>. You can add a
                note with any choice, and your team is notified right away.
              </p>
            </div>

            <div className="space-y-4">
              {pending.map((approval) => {
                const inFlight = submitting[approval.id];
                const busy = Boolean(inFlight);
                return (
                  <Card
                    key={approval.id}
                    className="space-y-4 border-l-4 border-l-amber-400/70 bg-card p-6"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
                          Needs your approval
                        </p>
                        {renderEntity(approval)}
                        {approval.note && (
                          <p className="text-sm text-foreground">{approval.note}</p>
                        )}
                      </div>
                      <span className="whitespace-nowrap text-sm text-muted-foreground">
                        {hydrated
                          ? `Requested ${format(new Date(approval.createdAt), "MMM d, yyyy")}`
                          : "Requested"}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`note-${approval.id}`}>
                        Add a note{" "}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </Label>
                      <Textarea
                        id={`note-${approval.id}`}
                        placeholder="Anything you'd like your team to know about this decision…"
                        value={notes[approval.id] ?? ""}
                        onChange={(e) =>
                          setNotes((n) => ({ ...n, [approval.id]: e.target.value }))
                        }
                        disabled={busy}
                        rows={2}
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {DECISIONS.map(({ value, label, icon: Icon, className }) => (
                        <Button
                          key={value}
                          type="button"
                          className={className}
                          disabled={busy}
                          onClick={() => handleDecide(approval, value)}
                        >
                          {inFlight === value ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Icon className="mr-2 h-4 w-4" />
                          )}
                          {label}
                        </Button>
                      ))}
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </section>

      {/* History — already decided */}
      {decided.length > 0 && (
        <section aria-labelledby="history-heading" className="space-y-4">
          <h2 id="history-heading" className="text-lg font-bold text-foreground">
            Decision history
          </h2>
          <Card className="divide-y divide-border bg-card">
            {decided.map((approval) => (
              <div key={approval.id} className="space-y-2 p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    {renderEntity(approval)}
                    {approval.note && (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Request:
                        </span>{" "}
                        {approval.note}
                      </p>
                    )}
                    {approval.decisionNote && (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">
                          Your note:
                        </span>{" "}
                        {approval.decisionNote}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 whitespace-nowrap">
                    <Badge className={approvalStatusBadgeClass(approval.status)}>
                      {approvalStatusLabel(approval.status)}
                    </Badge>
                    {hydrated && approval.decidedAt && (
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(approval.decidedAt), "MMM d, yyyy")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
