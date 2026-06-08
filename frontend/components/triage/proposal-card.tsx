"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { priorityBadgeClass } from "@/lib/badge-styles";
import { type TriageProposal } from "@/lib/triage-api";
import {
  Check,
  X,
  ChevronDown,
  ChevronRight,
  Sparkles,
  User as UserIcon,
  FileText,
  Loader2,
  ArrowRight,
  CornerDownRight,
  Copy,
  Mic,
  Gauge,
} from "lucide-react";

// A loaded project the user can route a proposal to. Kept minimal — the page
// passes whatever it pulls from GET /projects.
export interface TriageProjectOption {
  id: string;
  projectNumber: string;
  title: string;
}

// Which review bucket this card sits in — drives the action affordances.
//   needs-project : agentKeep && !proposedProjectId && !dedupeNote  (HERO)
//   routed        : agentKeep && proposedProjectId
//   duplicate     : dedupeNote != null
//   set-aside     : agentKeep === false
export type ProposalVariant = "needs-project" | "routed" | "duplicate" | "set-aside";

interface ProposalCardProps {
  proposal: TriageProposal;
  variant: ProposalVariant;
  projects: TriageProjectOption[];
  projectsLoading?: boolean;
  // Selection (only wired for the "needs-project" hero section).
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  // Mutations — the parent owns list state + toasts; these resolve when the
  // server call settles. The card manages its own pending/error affordances.
  onApprove: (id: string, targetProjectId?: string) => Promise<void>;
  onReject: (id: string, reason?: string) => Promise<void>;
}

const SOURCE_LABELS: Record<string, string> = {
  MEETING_OPS: "Meeting Ops",
  MANUAL: "Manual",
};

function sourceLabel(sourceType: string): string {
  return (
    SOURCE_LABELS[sourceType] ??
    sourceType
      .replace(/_/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function ProposalCard({
  proposal,
  variant,
  projects,
  projectsLoading = false,
  selectable = false,
  selected = false,
  onToggleSelect,
  onApprove,
  onReject,
}: ProposalCardProps) {
  // Project chosen for unassigned / override / approve-anyway flows.
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  // "routed" cards reveal a Select only after the user clicks "Change project".
  const [showChangeProject, setShowChangeProject] = useState(false);
  const [approving, setApproving] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showWhy, setShowWhy] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  const needsProjectPick =
    variant === "needs-project" || variant === "duplicate" || variant === "set-aside";

  const meetingTitle: string | undefined =
    (proposal.sourceRef?.meetingTitle as string | undefined) || undefined;

  const handleApprove = async (targetProjectId?: string) => {
    setApproving(true);
    try {
      await onApprove(proposal.id, targetProjectId);
    } finally {
      setApproving(false);
    }
  };

  const handleReject = async () => {
    setRejecting(true);
    try {
      await onReject(proposal.id, rejectReason.trim() || undefined);
    } finally {
      setRejecting(false);
    }
  };

  const busy = approving || rejecting;

  // Project <Select> shared by every flow that needs a target.
  const projectSelect = (
    <Select
      value={selectedProjectId}
      onValueChange={setSelectedProjectId}
      disabled={busy || projectsLoading}
    >
      <SelectTrigger className="h-8 w-full min-w-[200px] sm:w-[240px]">
        <SelectValue
          placeholder={projectsLoading ? "Loading projects…" : "Select a project…"}
        />
      </SelectTrigger>
      <SelectContent>
        {projects.length === 0 && !projectsLoading ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">
            No projects yet
          </div>
        ) : (
          projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {p.projectNumber}
                </span>
                <span className="truncate">{p.title}</span>
              </span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  );

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        selected
          ? "border-primary/60 bg-primary/[0.04] ring-1 ring-primary/30"
          : "border-border/70 bg-card hover:border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Multi-select checkbox (hero section only). */}
        {selectable && (
          <button
            type="button"
            onClick={() => onToggleSelect?.(proposal.id)}
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border transition-colors hover:border-primary"
            aria-label={selected ? "Deselect item" : "Select item"}
          >
            {selected && <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} />}
          </button>
        )}

        <div className="min-w-0 flex-1">
          {/* Top row: cleaned title + priority + meta chips */}
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {proposal.proposedTitle || proposal.rawText}
            </h3>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${priorityBadgeClass(
                proposal.proposedPriority
              )}`}
            >
              {proposal.proposedPriority}
            </span>
            {proposal.owner && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <Mic className="h-3 w-3" />
                {proposal.owner}
              </span>
            )}
            {typeof proposal.matchScore === "number" && (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70"
                title="Agent confidence (cosine to top project)"
              >
                <Gauge className="h-3 w-3" />
                {Math.round(proposal.matchScore * 100)}% match
              </span>
            )}
          </div>

          {/* Original action-item text */}
          <p className="text-sm leading-relaxed text-muted-foreground">
            {proposal.rawText}
          </p>

          {/* Source line */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {sourceLabel(proposal.sourceType)}
            </span>
            {meetingTitle && (
              <span className="inline-flex items-center gap-1">
                <span className="text-muted-foreground/40">·</span>
                {meetingTitle}
              </span>
            )}
          </div>

          {/* Routed target — prominent for the "routed" variant. */}
          {variant === "routed" && proposal.proposedProject && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <ArrowRight className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70">
                  Routes to
                </div>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="font-mono text-xs text-emerald-700 dark:text-emerald-300">
                    {proposal.proposedProject.projectNumber}
                  </span>
                  <span className="truncate">{proposal.proposedProject.title}</span>
                </div>
              </div>
            </div>
          )}

          {/* Alternatives as secondary chips (routed variant, surfaced inline). */}
          {variant === "routed" && proposal.alternatives.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground/70">Also considered:</span>
              {proposal.alternatives.map((alt) => (
                <span
                  key={alt.number}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                  title={alt.title}
                >
                  <span className="font-mono">{alt.number}</span>
                  <span className="max-w-[10rem] truncate">{alt.title}</span>
                </span>
              ))}
            </div>
          )}

          {/* Dedupe note (duplicate variant). */}
          {variant === "duplicate" && proposal.dedupeNote && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
              <Copy className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{proposal.dedupeNote}</span>
            </div>
          )}

          {/* Collapsible "why" (reasoning). */}
          {proposal.reasoning && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowWhy((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showWhy ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                <Sparkles className="h-3 w-3" />
                Why the agent suggested this
              </button>
              {showWhy && (
                <p className="mt-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {proposal.reasoning}
                </p>
              )}
            </div>
          )}

          {/* Expandable detail — alternatives (non-routed) + full source. */}
          {(proposal.alternatives.length > 0 || proposal.sourceRef) && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetail((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showDetail ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Details
              </button>
              {showDetail && (
                <div className="mt-1.5 space-y-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                  {proposal.alternatives.length > 0 && (
                    <div>
                      <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground/70">
                        Candidate projects
                      </div>
                      <ul className="space-y-0.5">
                        {proposal.alternatives.map((alt) => (
                          <li
                            key={alt.number}
                            className="flex items-center gap-2 text-muted-foreground"
                          >
                            <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                            <span className="font-mono">{alt.number}</span>
                            <span className="truncate">{alt.title}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {proposal.sourceRef && (
                    <div>
                      <div className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground/70">
                        Source
                      </div>
                      <dl className="space-y-0.5">
                        {Object.entries(proposal.sourceRef).map(([key, value]) => (
                          <div key={key} className="flex gap-2 text-muted-foreground">
                            <dt className="font-medium">{key}:</dt>
                            <dd className="truncate">{String(value)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Inline reject-reason field. */}
          {showReject && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional)…"
                className="h-8 flex-1 min-w-[200px]"
                disabled={rejecting}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleReject();
                  }
                }}
              />
              <Button
                size="sm"
                variant="destructive"
                className="h-8"
                onClick={handleReject}
                disabled={rejecting}
              >
                {rejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirm reject"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setShowReject(false);
                  setRejectReason("");
                }}
                disabled={rejecting}
              >
                Cancel
              </Button>
            </div>
          )}

          {/* Actions row (hidden while the reject field is open). */}
          {!showReject && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {variant === "routed" ? (
                <>
                  {!showChangeProject ? (
                    <>
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => handleApprove()}
                        disabled={busy}
                      >
                        {approving ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => setShowChangeProject(true)}
                        disabled={busy}
                      >
                        Change project
                        <ChevronDown className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </>
                  ) : (
                    <>
                      {projectSelect}
                      <Button
                        size="sm"
                        className="h-8"
                        onClick={() => handleApprove(selectedProjectId)}
                        disabled={busy || !selectedProjectId}
                      >
                        {approving ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Approve here
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() => {
                          setShowChangeProject(false);
                          setSelectedProjectId("");
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  {/* needs-project / duplicate / set-aside all approve into a
                      picked project. */}
                  {projectSelect}
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={() => handleApprove(selectedProjectId)}
                    disabled={busy || !selectedProjectId}
                  >
                    {approving ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {variant === "needs-project" ? "Approve" : "Approve anyway"}
                  </Button>
                </>
              )}

              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-muted-foreground hover:text-rose-600 dark:hover:text-rose-400"
                onClick={() => setShowReject(true)}
                disabled={busy}
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                {variant === "duplicate" || variant === "set-aside"
                  ? "Reject (dismiss)"
                  : "Reject"}
              </Button>
            </div>
          )}

          {needsProjectPick && !selectedProjectId && !showReject && (
            <p className="mt-1.5 text-[11px] text-muted-foreground/70">
              Pick a project to approve this item into.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
