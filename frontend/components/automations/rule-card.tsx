"use client";

import { Activity, Pencil, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useHydrated } from "@/lib/use-hydrated";
import type { AutomationRule } from "@/lib/automations-api";
import { describeRule, TRIGGER_META, type NameLookups } from "./automation-meta";

/**
 * One automation rendered as a card: name + trigger badge, the plain-English
 * "When … if … then …" summary, an enabled toggle, run stats, and edit/delete.
 * `lastRunAt` is formatted under useHydrated() so the relative-ish timestamp
 * never mismatches between the server render and the first client render.
 */

interface RuleCardProps {
  rule: AutomationRule;
  names: NameLookups;
  /** Toggling is optimistic in the parent; this just reports the new value. */
  onToggle: (rule: AutomationRule, enabled: boolean) => void;
  togglePending?: boolean;
  onEdit: (rule: AutomationRule) => void;
  onDelete: (rule: AutomationRule) => void;
}

export function RuleCard({
  rule,
  names,
  onToggle,
  togglePending,
  onEdit,
  onDelete,
}: RuleCardProps) {
  const hydrated = useHydrated();
  const triggerMeta = TRIGGER_META[rule.trigger];
  const TriggerIcon = triggerMeta?.icon ?? Activity;
  const summary = describeRule(rule, names);

  return (
    <Card
      className={`p-5 transition-colors ${rule.enabled ? "" : "opacity-70"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-foreground">
              {rule.name}
            </h3>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${triggerMeta?.tone ?? "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"}`}
            >
              <TriggerIcon className="h-3 w-3" />
              {triggerMeta?.label ?? rule.trigger}
            </span>
            {!rule.enabled && (
              <span className="inline-flex shrink-0 items-center rounded-full bg-zinc-500/15 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Paused
              </span>
            )}
          </div>

          {/* Plain-English summary */}
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {summary}
          </p>

          {/* Run stats */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              <span className="tabular-nums font-medium text-foreground">
                {rule.runCount.toLocaleString()}
              </span>
              {rule.runCount === 1 ? "run" : "runs"}
            </span>
            <span>
              Last run:{" "}
              <span className="text-foreground">
                {hydrated ? formatLastRun(rule.lastRunAt) : "—"}
              </span>
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="flex shrink-0 flex-col items-end gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {rule.enabled ? "On" : "Off"}
            </span>
            <Switch
              checked={rule.enabled}
              disabled={togglePending}
              onCheckedChange={(checked) => onToggle(rule, checked)}
              aria-label={rule.enabled ? `Disable ${rule.name}` : `Enable ${rule.name}`}
            />
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(rule)}
              className="text-primary hover:bg-primary/10 hover:text-primary/90"
              aria-label={`Edit ${rule.name}`}
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(rule)}
              className="text-rose-600 hover:bg-rose-500/10 hover:text-rose-700"
              aria-label={`Delete ${rule.name}`}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Compact, locale-safe last-run label (date only — no per-second drift). */
function formatLastRun(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const dayMs = 86_400_000;
  if (diffMs < dayMs && d.toDateString() === new Date(now).toDateString()) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (diffMs < 7 * dayMs) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
