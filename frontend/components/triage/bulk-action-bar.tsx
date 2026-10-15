"use client";

import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { TriageReasonPreset } from "@/lib/triage-api";
import type { TriageProjectOption } from "@/components/triage/proposal-card";

export interface TriageTaskOption {
  id: string;
  title: string;
  projectNumber?: string;
}

const NO_SELECTION = "__none__";

const REASON_PRESETS: { value: TriageReasonPreset; label: string }[] = [
  { value: "stale", label: "Stale" },
  { value: "duplicate", label: "Duplicate" },
  { value: "not_ours", label: "Not ours" },
  { value: "handled_elsewhere", label: "Handled elsewhere" },
  { value: "vague", label: "Too vague" },
  { value: "personal", label: "Personal" },
];

interface BulkActionBarProps {
  selectedCount: number;
  projects: TriageProjectOption[];
  projectsLoading: boolean;
  tasks: TriageTaskOption[];
  tasksLoading: boolean;
  projectId: string;
  onProjectChange: (value: string) => void;
  reasonPreset: TriageReasonPreset | "";
  onReasonPresetChange: (value: TriageReasonPreset | "") => void;
  reason: string;
  onReasonChange: (value: string) => void;
  duplicateOfTaskId: string;
  onDuplicateOfTaskChange: (value: string) => void;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onClear: () => void;
}

export function BulkActionBar({
  selectedCount,
  projects,
  projectsLoading,
  tasks,
  tasksLoading,
  projectId,
  onProjectChange,
  reasonPreset,
  onReasonPresetChange,
  reason,
  onReasonChange,
  duplicateOfTaskId,
  onDuplicateOfTaskChange,
  busy,
  onApprove,
  onReject,
  onClear,
}: BulkActionBarProps) {
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/[0.04] p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">
            {selectedCount} proposal{selectedCount === 1 ? "" : "s"} selected
          </p>
          <p className="text-xs text-muted-foreground">
            Each proposal gets an independent result; failed items stay selected.
          </p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={busy}>
          <X className="mr-1.5 h-3.5 w-3.5" />
          Clear selection
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="rounded-lg border border-border/70 bg-card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Approve into
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={projectId} onValueChange={onProjectChange} disabled={busy || projectsLoading}>
              <SelectTrigger className="h-8 min-w-[220px] flex-1">
                <SelectValue
                  placeholder={projectsLoading ? "Loading projects…" : "Choose a project…"}
                />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">
                        {project.projectNumber}
                      </span>
                      <span className="truncate">{project.title}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              className="h-8"
              onClick={onApprove}
              disabled={busy || !projectId}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve selected"}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            This project overrides the agent&apos;s proposed project for every selected item.
          </p>
        </div>

        <div className="rounded-lg border border-border/70 bg-card p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Reject with
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              value={reasonPreset || NO_SELECTION}
              onValueChange={(value) =>
                onReasonPresetChange(value === NO_SELECTION ? "" : (value as TriageReasonPreset))
              }
              disabled={busy}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Choose a reason preset…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>Choose a reason preset…</SelectItem>
                {REASON_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={duplicateOfTaskId || NO_SELECTION}
              onValueChange={(value) =>
                onDuplicateOfTaskChange(value === NO_SELECTION ? "" : value)
              }
              disabled={busy || tasksLoading}
            >
              <SelectTrigger className="h-8">
                <SelectValue
                  placeholder={tasksLoading ? "Loading tasks…" : "Duplicate of task (optional)"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_SELECTION}>No duplicate task</SelectItem>
                {tasks.map((task) => (
                  <SelectItem key={task.id} value={task.id}>
                    <span className="flex items-center gap-2">
                      {task.projectNumber && (
                        <span className="font-mono text-xs text-muted-foreground">
                          {task.projectNumber}
                        </span>
                      )}
                      <span className="truncate">{task.title}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Optional note…"
              className="h-8 min-w-[220px] flex-1"
              disabled={busy}
            />
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8"
              onClick={onReject}
              disabled={busy || !reasonPreset}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reject selected"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

