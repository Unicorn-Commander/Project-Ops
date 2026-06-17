"use client";

/**
 * Create / edit a manual time entry. Matches the app's overlay-Card modal
 * pattern (see components/modals/create-task-modal.tsx).
 *
 * Create: POST /time-entries — needs a project (or task) and a duration. We
 * collect a date + start time + duration in minutes (the simplest reliable
 * combo the backend accepts: startedAt + durationMinutes).
 *
 * Edit: PATCH /time-entries/:id — only DRAFT, unlocked, unbilled entries are
 * mutable; the parent only opens edit for those. We send description / taskId /
 * billable / startedAt / durationMinutes.
 */

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { ProjectPicker, TaskPicker } from "@/components/time-tracking/entity-pickers";
import {
  createTimeEntry,
  updateTimeEntry,
  getProjectOptions,
  type ProjectOption,
  type TimeEntry,
} from "@/lib/time-tracking-api";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** When set, the modal edits this entry; otherwise it creates a new one. */
  entry?: TimeEntry | null;
  /** Pre-seed the project (e.g. logging from a project context). */
  preselectedProjectId?: string;
}

/** Round to local "YYYY-MM-DDTHH:mm" for <input type=datetime-local>. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function TimeEntryModal({
  isOpen,
  onClose,
  onSuccess,
  entry,
  preselectedProjectId,
}: Props) {
  const { toast } = useToast();
  const isEdit = !!entry;

  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [startedAtLocal, setStartedAtLocal] = useState(toLocalInput(new Date()));
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [description, setDescription] = useState("");
  const [billable, setBillable] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load project options once (create needs them; edit shows project read-only).
  useEffect(() => {
    if (isOpen && !projectsLoaded) {
      getProjectOptions()
        .then(setProjects)
        .catch(() => setProjects([]))
        .finally(() => setProjectsLoaded(true));
    }
  }, [isOpen, projectsLoaded]);

  // Seed fields when opening.
  useEffect(() => {
    if (!isOpen) return;
    if (entry) {
      setProjectId(entry.projectId);
      setTaskId(entry.taskId ?? "");
      setStartedAtLocal(toLocalInput(new Date(entry.startedAt)));
      const secs = entry.durationSeconds ?? 0;
      setDurationMinutes(secs ? String(Math.round(secs / 60)) : "");
      setDescription(entry.description ?? "");
      setBillable(entry.billable);
    } else {
      setProjectId(preselectedProjectId ?? "");
      setTaskId("");
      setStartedAtLocal(toLocalInput(new Date()));
      setDurationMinutes("60");
      setDescription("");
      setBillable(true);
    }
  }, [isOpen, entry, preselectedProjectId]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const minutesNum = Number(durationMinutes);
  const validDuration = durationMinutes !== "" && !Number.isNaN(minutesNum) && minutesNum > 0;
  const canSubmit = !!projectId && validDuration && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    const startedAtIso = new Date(startedAtLocal).toISOString();
    try {
      if (isEdit && entry) {
        await updateTimeEntry(entry.id, {
          description: description.trim() || undefined,
          taskId: taskId || undefined,
          startedAt: startedAtIso,
          durationMinutes: minutesNum,
          billable,
        });
        toast({ title: "Entry updated" });
      } else {
        await createTimeEntry({
          projectId,
          taskId: taskId || undefined,
          description: description.trim() || undefined,
          startedAt: startedAtIso,
          durationMinutes: minutesNum,
          billable,
        });
        toast({ title: "Time logged" });
      }
      onSuccess();
      onClose();
    } catch (e: any) {
      toast({
        title: isEdit ? "Couldn't update entry" : "Couldn't log time",
        description: e?.response?.data?.message || "Please check the fields and try again.",
        variant: "destructive",
      });
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
      <Card className="mx-4 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto animate-in zoom-in-95 duration-200">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {isEdit ? "Edit time entry" : "Log time"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {isEdit
                ? "Adjust this draft entry."
                : "Record time you've already worked."}
            </p>
          </div>
          <Button aria-label="Close" variant="outline" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Project</Label>
            {isEdit ? (
              <div className="flex h-10 items-center rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground">
                {entry?.project
                  ? `${entry.project.projectNumber} — ${entry.project.title}`
                  : entry?.projectId}
              </div>
            ) : !projectsLoaded ? (
              <div className="flex h-10 items-center rounded-md border border-input px-3 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading projects…
              </div>
            ) : projects.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No projects available to log against.
              </p>
            ) : (
              <ProjectPicker
                projects={projects}
                value={projectId}
                onChange={(v) => {
                  setProjectId(v);
                  setTaskId("");
                }}
                disabled={!!preselectedProjectId}
              />
            )}
          </div>

          <div>
            <Label className="mb-1.5 block">Task (optional)</Label>
            <TaskPicker projectId={projectId} value={taskId} onChange={setTaskId} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="te-started" className="mb-1.5 block">
                Started
              </Label>
              <Input
                id="te-started"
                type="datetime-local"
                value={startedAtLocal}
                onChange={(e) => setStartedAtLocal(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="te-duration" className="mb-1.5 block">
                Minutes
              </Label>
              <Input
                id="te-duration"
                type="number"
                min={1}
                step={1}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="60"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="te-desc" className="mb-1.5 block">
              Description
            </Label>
            <Textarea
              id="te-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What did you work on?"
            />
          </div>

          <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="te-billable" className="block">
                Billable
              </Label>
              <p className="text-xs text-muted-foreground">
                Counts toward client billing &amp; utilization.
              </p>
            </div>
            <Switch id="te-billable" checked={billable} onCheckedChange={setBillable} />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3 border-t pt-4">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {isEdit ? "Saving…" : "Logging…"}
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Log time"
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
