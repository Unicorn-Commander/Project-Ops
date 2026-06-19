"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { HelpHint } from "@/components/guidance";
import { useToast } from "@/components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ListToolbar, type FilterOption } from "@/components/ui/list-toolbar";
import {
  deleteAutomation,
  getAutomations,
  setAutomationEnabled,
  type AutomationRule,
  type AutomationTrigger,
} from "@/lib/automations-api";
import { RuleCard } from "@/components/automations/rule-card";
import { RuleBuilder } from "@/components/automations/rule-builder";
import { TRIGGER_OPTIONS } from "@/components/automations/automation-meta";
import { useAutomationOptions } from "@/components/automations/use-automation-options";
import {
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
} from "@/components/automations/templates";

const TRIGGER_FILTER_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All triggers" },
  ...TRIGGER_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
];

const ENABLED_FILTER_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "On + off" },
  { value: "ON", label: "On only", dot: "bg-emerald-500" },
  { value: "OFF", label: "Off only", dot: "bg-zinc-500" },
];

export default function AutomationsPage() {
  const router = useRouter();
  const { toast } = useToast();
  // Loaded once so the cards' summaries can resolve userId/projectId → names.
  const { userName, projectName } = useAutomationOptions(true);

  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("ALL");
  const [enabledFilter, setEnabledFilter] = useState<"ALL" | "ON" | "OFF">("ALL");

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AutomationRule | null>(null);
  const [templateSeed, setTemplateSeed] = useState<AutomationTemplate["rule"] | null>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<AutomationRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchRules();
    // Fetch once on mount; fetchRules is stable for this page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link from the Cmd+K palette: ?new=1 opens the builder.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      openCreate();
      router.replace("/dashboard/automations");
    }
  }, [router]);

  const fetchRules = async () => {
    try {
      setLoading(true);
      const data = await getAutomations();
      setRules(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.response?.data?.message || "Failed to load automations",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditingRule(null);
    setTemplateSeed(null);
    setBuilderOpen(true);
  };

  const openFromTemplate = (tpl: AutomationTemplate) => {
    setEditingRule(null);
    setTemplateSeed(tpl.rule);
    setBuilderOpen(true);
  };

  const openEdit = (rule: AutomationRule) => {
    setTemplateSeed(null);
    setEditingRule(rule);
    setBuilderOpen(true);
  };

  // Optimistic toggle: flip locally now, reconcile (or revert) against the API.
  const handleToggle = async (rule: AutomationRule, enabled: boolean) => {
    setTogglingId(rule.id);
    setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)));
    try {
      const updated = await setAutomationEnabled(rule.id, enabled);
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (error: any) {
      // Revert the optimistic flip.
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: !enabled } : r)));
      toast({
        title: "Error",
        description: error?.response?.data?.message || "Failed to update the automation",
        variant: "destructive",
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!ruleToDelete) return;
    try {
      setDeleting(true);
      await deleteAutomation(ruleToDelete.id);
      setRules((prev) => prev.filter((r) => r.id !== ruleToDelete.id));
      toast({ title: "Automation deleted", description: `"${ruleToDelete.name}" was removed.` });
      setRuleToDelete(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.response?.data?.message || "Failed to delete the automation",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const filteredRules = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return rules.filter((r) => {
      if (triggerFilter !== "ALL" && r.trigger !== (triggerFilter as AutomationTrigger)) return false;
      if (enabledFilter === "ON" && !r.enabled) return false;
      if (enabledFilter === "OFF" && r.enabled) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rules, searchTerm, triggerFilter, enabledFilter]);

  const clearFilters = () => {
    setSearchTerm("");
    setTriggerFilter("ALL");
    setEnabledFilter("ALL");
  };

  const stats = useMemo(() => {
    const total = rules.length;
    const active = rules.filter((r) => r.enabled).length;
    const totalRuns = rules.reduce((sum, r) => sum + (r.runCount || 0), 0);
    return { total, active, paused: total - active, totalRuns };
  }, [rules]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary">
                <Zap className="h-6 w-6 text-white" strokeWidth={2.25} />
              </div>
              <div>
                <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
                  Automations
                  <HelpHint
                    icon="info"
                    side="bottom"
                    size={16}
                    aria-label="About automations"
                    learnMore={{ category: "automations", article: "automations-overview" }}
                  >
                    No-code <span className="font-semibold">When → If → Then</span> rules.
                    When a matching event fires, Project-Ops checks your conditions and runs
                    your actions — assigning, commenting, setting statuses, or notifying — with
                    no one lifting a finger.
                  </HelpHint>
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Rules that run themselves — when something happens, do this.
                </p>
              </div>
            </div>
            <Button
              onClick={openCreate}
              className="bg-primary px-6 py-3 text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              New automation
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-6 py-8">
        {/* Summary stats */}
        {!loading && rules.length > 0 && (
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              {
                label: "Total rules",
                value: stats.total,
                stripe: "border-l-foreground/40",
                wash: "bg-foreground/[0.03] dark:bg-foreground/[0.04]",
              },
              {
                label: "Active",
                value: stats.active,
                stripe: "border-l-emerald-500 dark:border-l-emerald-400",
                wash: "bg-emerald-500/10 dark:bg-emerald-400/10",
              },
              {
                label: "Paused",
                value: stats.paused,
                stripe: "border-l-zinc-400 dark:border-l-zinc-500",
                wash: "bg-zinc-500/10",
              },
              {
                label: "Total runs",
                value: stats.totalRuns,
                stripe: "border-l-violet-500 dark:border-l-violet-400",
                wash: "bg-violet-500/10 dark:bg-violet-400/10",
              },
            ].map(({ label, value, stripe, wash }) => (
              <Card key={label} className={`border-l-4 p-4 ${stripe} ${wash}`}>
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {label}
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
                  {value.toLocaleString()}
                </p>
              </Card>
            ))}
          </div>
        )}

        {/* Toolbar — only when there's something to filter */}
        {!loading && rules.length > 0 && (
          <ListToolbar
            search={{
              value: searchTerm,
              onChange: setSearchTerm,
              placeholder: "Search automations by name…",
            }}
            filters={[
              {
                key: "trigger",
                label: "Trigger",
                value: triggerFilter,
                onChange: setTriggerFilter,
                options: TRIGGER_FILTER_OPTIONS,
              },
              {
                key: "enabled",
                label: "State",
                value: enabledFilter,
                onChange: (v) => setEnabledFilter(v as "ALL" | "ON" | "OFF"),
                options: ENABLED_FILTER_OPTIONS,
              },
            ]}
          />
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-5 w-28 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-40" />
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <Skeleton className="h-6 w-11 rounded-full" />
                    <Skeleton className="h-8 w-20" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : rules.length === 0 ? (
          // First-run empty state — explain the feature + offer templates.
          <Card className="p-2">
            <EmptyState
              icon={Zap}
              iconTone="primary"
              title="No automations yet"
              body="Automations run on their own: when something happens in a project or task, they take care of the busywork — assigning, commenting, setting statuses, or pinging the right person."
              action={
                <Button onClick={openCreate}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create automation
                </Button>
              }
              className="border-0"
            />
            <div className="px-6 pb-6">
              <p className="mb-3 text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Or start from a template
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {AUTOMATION_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => openFromTemplate(tpl)}
                    className="group rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/[0.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary">
                        <Zap className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary">
                        {tpl.title}
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                      {tpl.blurb}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        ) : filteredRules.length === 0 ? (
          // Filters hide everything.
          <Card>
            <EmptyState
              icon={Search}
              iconTone="zinc"
              title="No automations match"
              body="Try a different search term, or clear the filters."
              action={
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
              className="m-4 border-0"
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                names={{ userName, projectName }}
                onToggle={handleToggle}
                togglePending={togglingId === rule.id}
                onEdit={openEdit}
                onDelete={setRuleToDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Builder (create / edit / from-template) */}
      <RuleBuilder
        open={builderOpen}
        onClose={() => {
          setBuilderOpen(false);
          setEditingRule(null);
          setTemplateSeed(null);
        }}
        onSuccess={fetchRules}
        rule={editingRule}
        template={templateSeed}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!ruleToDelete} onOpenChange={(o) => { if (!o) setRuleToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-semibold">{ruleToDelete?.name}</span>? This
              stops the rule from running and can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
