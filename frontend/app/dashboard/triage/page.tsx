"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { iconWellClass } from "@/lib/badge-styles";
import api from "@/lib/api";
import {
  getTriageProposals,
  approveProposal,
  rejectProposal,
  type TriageProposal,
} from "@/lib/triage-api";
import {
  ProposalCard,
  type TriageProjectOption,
} from "@/components/triage/proposal-card";
import { CreateProjectFromProposalsModal } from "@/components/triage/create-project-from-proposals-modal";
import {
  Inbox,
  FolderInput,
  Copy,
  Archive,
  ChevronDown,
  ChevronRight,
  Sparkles,
  FolderPlus,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

// Client-side grouping of PENDING_REVIEW proposals into the four review
// buckets. Order of checks matters: dedupe/set-aside take precedence so a
// duplicate never also shows up under "needs a project".
function groupProposals(proposals: TriageProposal[]) {
  const needsProject: TriageProposal[] = [];
  const routed: TriageProposal[] = [];
  const duplicates: TriageProposal[] = [];
  const setAside: TriageProposal[] = [];

  for (const p of proposals) {
    if (!p.agentKeep) {
      setAside.push(p);
    } else if (p.dedupeNote != null) {
      duplicates.push(p);
    } else if (p.proposedProjectId) {
      routed.push(p);
    } else {
      needsProject.push(p);
    }
  }

  return { needsProject, routed, duplicates, setAside };
}

export default function TriagePage() {
  const [proposals, setProposals] = useState<TriageProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [projects, setProjects] = useState<TriageProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  // Collapsible sections — duplicates + set-aside start collapsed.
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showSetAside, setShowSetAside] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchProposals();
    fetchProjects();
  }, []);

  const fetchProposals = async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await getTriageProposals();
      setProposals(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(true);
      setProposals([]);
      toast({
        title: "Error",
        description: "Failed to load triage proposals",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // Projects power the route/override/approve-anyway <Select>. One round-trip,
  // shared by every card.
  const fetchProjects = async () => {
    setProjectsLoading(true);
    try {
      const response = await api.get("/projects?page=1&limit=500");
      const list = response.data?.data ?? [];
      setProjects(
        list.map((p: any) => ({
          id: p.id,
          projectNumber: p.projectNumber,
          title: p.title,
        })),
      );
    } catch (err) {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  const handleRefresh = () => {
    setSelectedIds(new Set());
    fetchProposals();
    fetchProjects();
  };

  // Approve — the card resolves on settle; we drop the proposal from the list
  // (it leaves PENDING_REVIEW) and toast. Throw on failure so the card can
  // restore its own pending state.
  const handleApprove = async (id: string, targetProjectId?: string) => {
    try {
      await approveProposal(id, targetProjectId ? { targetProjectId } : {});
      setProposals((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({
        title: "Approved",
        description: "Action item turned into a task.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.response?.data?.message || "Failed to approve item",
        variant: "destructive",
      });
      throw err;
    }
  };

  const handleReject = async (id: string, reason?: string) => {
    try {
      await rejectProposal(id, reason ? { reason } : {});
      setProposals((prev) => prev.filter((p) => p.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast({
        title: "Rejected",
        description: "Item dismissed — it won't become a task.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.response?.data?.message || "Failed to reject item",
        variant: "destructive",
      });
      throw err;
    }
  };

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { needsProject, routed, duplicates, setAside } = useMemo(
    () => groupProposals(proposals),
    [proposals],
  );

  // Selected proposals confined to the hero section (the only selectable one).
  const selectedProposals = useMemo(
    () => needsProject.filter((p) => selectedIds.has(p.id)),
    [needsProject, selectedIds],
  );

  const allHeroSelected =
    needsProject.length > 0 && needsProject.every((p) => selectedIds.has(p.id));
  const toggleSelectAllHero = () => {
    setSelectedIds((prev) => {
      if (allHeroSelected) {
        const next = new Set(prev);
        needsProject.forEach((p) => next.delete(p.id));
        return next;
      }
      const next = new Set(prev);
      needsProject.forEach((p) => next.add(p.id));
      return next;
    });
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-96" />
        <Card className="p-6 space-y-4">
          <Skeleton className="h-5 w-48" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-border/70 p-4 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <SkeletonText lines={2} />
              <Skeleton className="h-8 w-64" />
            </div>
          ))}
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="po-page-enter space-y-6">
        <PageHeader onRefresh={handleRefresh} />
        <Card className="p-12">
          <EmptyState
            icon={AlertTriangle}
            iconTone="rose"
            title="Couldn't load proposals"
            body="Something went wrong fetching the triage queue. Try again."
            action={
              <Button variant="outline" onClick={handleRefresh}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const totalPending = proposals.length;

  return (
    <>
      <CreateProjectFromProposalsModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        proposals={selectedProposals}
        onSuccess={() => {
          handleRefresh();
        }}
      />

      <div className="po-page-enter space-y-6">
        <PageHeader onRefresh={handleRefresh} />

        {totalPending === 0 ? (
          <Card className="p-12">
            <EmptyState
              icon={CheckCircle2}
              iconTone="emerald"
              title="Inbox zero"
              body="No proposals are waiting for review. When the agent suggests new action items, they'll land here for your approval."
            />
          </Card>
        ) : (
          <div className="space-y-6">
            {/* 1) HERO — Needs a project */}
            <Card className="overflow-visible p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconWellClass(
                      "primary",
                    )}`}
                  >
                    <FolderInput className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">
                      Needs a project
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Real action items the agent couldn't confidently route. Approve into a
                      project, or group several into a new one.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {needsProject.length}
                </span>
              </div>

              {needsProject.length === 0 ? (
                <EmptyState
                  icon={FolderInput}
                  iconTone="primary"
                  title="Nothing unrouted"
                  body="Every kept item was confidently routed or flagged elsewhere."
                />
              ) : (
                <>
                  {/* Section toolbar — select-all + create-from-selected. */}
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
                    <button
                      type="button"
                      onClick={toggleSelectAllHero}
                      className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span
                        className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                          allHeroSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border"
                        }`}
                      >
                        {allHeroSelected && (
                          <CheckCircle2 className="h-3 w-3" strokeWidth={3} />
                        )}
                      </span>
                      {allHeroSelected ? "Deselect all" : "Select all"}
                      {selectedProposals.length > 0 && (
                        <span className="text-muted-foreground/70">
                          · {selectedProposals.length} selected
                        </span>
                      )}
                    </button>
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={selectedProposals.length === 0}
                      onClick={() => setCreateModalOpen(true)}
                    >
                      <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                      Create project from selected ({selectedProposals.length})
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {needsProject.map((p) => (
                      <ProposalCard
                        key={p.id}
                        proposal={p}
                        variant="needs-project"
                        projects={projects}
                        projectsLoading={projectsLoading}
                        selectable
                        selected={selectedIds.has(p.id)}
                        onToggleSelect={toggleSelected}
                        onApprove={handleApprove}
                        onReject={handleReject}
                      />
                    ))}
                  </div>
                </>
              )}
            </Card>

            {/* 2) Routed to a project */}
            <Card className="overflow-visible p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconWellClass(
                      "emerald",
                    )}`}
                  >
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">
                      Routed to a project
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      The agent matched these to an existing project. Approve, or override
                      the target.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  {routed.length}
                </span>
              </div>

              {routed.length === 0 ? (
                <EmptyState
                  icon={Sparkles}
                  iconTone="emerald"
                  title="Nothing routed"
                  body="No items were confidently matched to an existing project."
                />
              ) : (
                <div className="space-y-3">
                  {routed.map((p) => (
                    <ProposalCard
                      key={p.id}
                      proposal={p}
                      variant="routed"
                      projects={projects}
                      projectsLoading={projectsLoading}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  ))}
                </div>
              )}
            </Card>

            {/* 3) Possible duplicates — collapsed by default. */}
            <Card className="overflow-visible p-6">
              <button
                type="button"
                onClick={() => setShowDuplicates((v) => !v)}
                className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {showDuplicates ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconWellClass(
                      "amber",
                    )}`}
                  >
                    <Copy className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">
                      Possible duplicates
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Likely already tracked as an existing task.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {duplicates.length}
                </span>
              </button>

              {showDuplicates && (
                <div className="mt-4">
                  {duplicates.length === 0 ? (
                    <EmptyState
                      icon={Copy}
                      iconTone="amber"
                      title="No duplicates flagged"
                      body="The agent didn't find anything that looks like an existing task."
                    />
                  ) : (
                    <div className="space-y-3">
                      {duplicates.map((p) => (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          variant="duplicate"
                          projects={projects}
                          projectsLoading={projectsLoading}
                          onApprove={handleApprove}
                          onReject={handleReject}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* 4) Agent set aside — collapsed by default. */}
            <Card className="overflow-visible p-6">
              <button
                type="button"
                onClick={() => setShowSetAside((v) => !v)}
                className="flex w-full flex-wrap items-center justify-between gap-3 text-left"
              >
                <div className="flex items-center gap-3">
                  {showSetAside ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconWellClass(
                      "zinc",
                    )}`}
                  >
                    <Archive className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">Agent set aside</h2>
                    <p className="text-xs text-muted-foreground">
                      The agent judged these as logistics or chit-chat, not tasks. Approve
                      anyway if it got one wrong.
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-zinc-500/15 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {setAside.length}
                </span>
              </button>

              {showSetAside && (
                <div className="mt-4">
                  {setAside.length === 0 ? (
                    <EmptyState
                      icon={Archive}
                      iconTone="zinc"
                      title="Nothing set aside"
                      body="The agent kept everything it saw as a real action item."
                    />
                  ) : (
                    <div className="space-y-3">
                      {setAside.map((p) => (
                        <ProposalCard
                          key={p.id}
                          proposal={p}
                          variant="set-aside"
                          projects={projects}
                          projectsLoading={projectsLoading}
                          onApprove={handleApprove}
                          onReject={handleReject}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </>
  );
}

// Page header — title lives in the top bar; this carries the subtitle + the
// Refresh control, matching the my-tasks / projects header pattern.
function PageHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Inbox className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Triage</h1>
          <p className="text-sm text-muted-foreground">
            AI-proposed action items awaiting your review — nothing becomes a task until you
            approve it.
          </p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Refresh
      </Button>
    </div>
  );
}
