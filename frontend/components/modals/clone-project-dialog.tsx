"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/components/workspace-provider";
import {
  cloneProject,
  type CloneDueDateMode,
  type CloneProjectResult,
} from "@/lib/api";
import { businessDateToday } from "@/lib/date-only";

const TITLE_MAX = 200;
const WRITE_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "MEMBER"]);

const DUE_DATE_OPTIONS: { value: CloneDueDateMode; label: string }[] = [
  { value: "keep", label: "Keep" },
  { value: "shift", label: "Shift to a start date" },
  { value: "clear", label: "Clear" },
];

interface CloneProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectTitle: string;
}

function copyTitle(title: string): string {
  const suffix = " (copy)";
  const base = title.trim();
  const full = `${base}${suffix}`;
  if (full.length <= TITLE_MAX) return full;
  return `${base.slice(0, TITLE_MAX - suffix.length).trimEnd()}${suffix}`;
}

function cloneErrorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "response" in error) {
    const data = (
      error as {
        response?: { data?: { message?: unknown } };
      }
    ).response?.data;
    const message = data?.message;
    if (Array.isArray(message)) {
      const text = message.filter((item) => typeof item === "string").join(" ");
      if (text.trim()) return text;
    }
    if (typeof message === "string" && message.trim()) return message;
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Could not clone this project.";
}

/**
 * Clone dialog for POST /projects/:id/clone.
 * Source workspace is the active one (the api interceptor header). The target
 * picker is the same membership list the header switcher uses.
 */
export function CloneProjectDialog({
  open,
  onOpenChange,
  projectId,
  projectTitle,
}: CloneProjectDialogProps) {
  const { workspaces, activeWorkspaceId, switchWorkspace } = useWorkspace();
  const titleId = useId();
  const workspaceId = useId();
  const tasksId = useId();
  const resetId = useId();
  const startId = useId();

  const [title, setTitle] = useState("");
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [includeTasks, setIncludeTasks] = useState(true);
  const [resetStatus, setResetStatus] = useState(true);
  const [dueDateMode, setDueDateMode] = useState<CloneDueDateMode>("shift");
  const [startDate, setStartDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CloneProjectResult | null>(null);
  // Seed once per open. A later workspace switch (opening the clone) must
  // not wipe the result screen.
  const seededFor = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededFor.current = null;
      return;
    }
    if (seededFor.current === projectId) return;
    seededFor.current = projectId;
    setTitle(copyTitle(projectTitle));
    setTargetWorkspaceId(activeWorkspaceId ?? "");
    setIncludeTasks(true);
    setResetStatus(true);
    setDueDateMode("shift");
    setStartDate(businessDateToday());
    setSubmitting(false);
    setError(null);
    setResult(null);
  }, [open, projectId, projectTitle, activeWorkspaceId]);

  const writableWorkspaces = workspaces.filter((ws) =>
    WRITE_ROLES.has(ws.role),
  );
  const canSubmit =
    !submitting &&
    !result &&
    title.trim().length <= TITLE_MAX &&
    targetWorkspaceId.trim().length > 0 &&
    (dueDateMode !== "shift" || startDate.trim().length > 0);

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const cloned = await cloneProject(projectId, {
        title: title.trim(),
        targetWorkspaceId,
        includeTasks,
        resetStatus,
        dueDateMode,
        startDate: dueDateMode === "shift" ? startDate : undefined,
      });
      setResult(cloned);
    } catch (err) {
      setError(cloneErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const clonedHref = result
    ? `/dashboard/projects/${result.project.id}`
    : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && submitting) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4 text-primary" />
            Clone project
          </DialogTitle>
          <DialogDescription>
            Copies this project into the workspace you pick. Tasks and
            dependencies are included when Copy tasks is on. Comments, time
            entries, approvals, and documents stay on the original.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm text-foreground">
              Cloned as{" "}
              <span className="font-medium">
                {result.project.projectNumber
                  ? `${result.project.projectNumber} · `
                  : ""}
                {result.project.title}
              </span>
              .
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Tasks copied</dt>
              <dd>{result.taskCount}</dd>
              <dt className="text-muted-foreground">Dependencies copied</dt>
              <dd>{result.dependencyCount}</dd>
              <dt className="text-muted-foreground">Dependencies skipped</dt>
              <dd>{result.skipped.dependencies}</dd>
              <dt className="text-muted-foreground">Assignees skipped</dt>
              <dd>{result.skipped.assignees}</dd>
              <dt className="text-muted-foreground">Custom fields skipped</dt>
              <dd>{result.skipped.customFields}</dd>
            </dl>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
              <Button asChild>
                <Link
                  href={clonedHref}
                  onClick={() => {
                    const destination =
                      result.project.workspaceId?.trim() ||
                      targetWorkspaceId.trim();
                    if (destination && destination !== activeWorkspaceId) {
                      switchWorkspace(destination);
                    }
                  }}
                >
                  Open cloned project
                </Link>
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor={titleId}>New title</Label>
              <Input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={TITLE_MAX}
                disabled={submitting}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={workspaceId}>Target workspace</Label>
              <Select
                value={targetWorkspaceId || undefined}
                onValueChange={setTargetWorkspaceId}
                disabled={submitting || workspaces.length === 0}
              >
                <SelectTrigger id={workspaceId}>
                  <SelectValue placeholder="Select a workspace" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => {
                    const canWrite = WRITE_ROLES.has(ws.role);
                    return (
                      <SelectItem
                        key={ws.workspaceId}
                        value={ws.workspaceId}
                        disabled={!canWrite}
                      >
                        {ws.displayName}
                        {ws.workspaceId === activeWorkspaceId ? " (current)" : ""}
                        {canWrite ? "" : " — view only"}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {writableWorkspaces.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  You need a member role in a workspace to receive the copy.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
              <Label htmlFor={tasksId} className="cursor-pointer">
                Copy tasks
              </Label>
              <Switch
                id={tasksId}
                checked={includeTasks}
                onCheckedChange={setIncludeTasks}
                disabled={submitting}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor={resetId} className="cursor-pointer">
                  Reset task status
                </Label>
                {!includeTasks && (
                  <p className="text-xs text-muted-foreground">
                    Applies when tasks are copied.
                  </p>
                )}
              </div>
              <Switch
                id={resetId}
                checked={resetStatus}
                onCheckedChange={setResetStatus}
                disabled={submitting || !includeTasks}
              />
            </div>

            <fieldset className="space-y-2" disabled={submitting}>
              <legend className="text-sm font-medium">Due dates</legend>
              {DUE_DATE_OPTIONS.map((option) => {
                const optionId = `${startId}-${option.value}`;
                return (
                  <label
                    key={option.value}
                    htmlFor={optionId}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      id={optionId}
                      type="radio"
                      name="clone-due-date-mode"
                      value={option.value}
                      checked={dueDateMode === option.value}
                      onChange={() => setDueDateMode(option.value)}
                      className="h-4 w-4 accent-primary"
                    />
                    {option.label}
                  </label>
                );
              })}
              {dueDateMode === "shift" && (
                <div className="space-y-1.5 pl-6">
                  <Label htmlFor={startId}>Start date</Label>
                  <Input
                    id={startId}
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    disabled={submitting}
                    required
                  />
                </div>
              )}
            </fieldset>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitting ? "Cloning…" : "Clone project"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
