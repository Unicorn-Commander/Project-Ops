"use client";

/**
 * Shared Project + Task pickers for the Time-Tracking surfaces (timer widget,
 * manual log, edit). Uses the app's Radix Select kit. Projects are loaded
 * once via `getProjectOptions`; tasks load lazily per selected project.
 *
 * These are intentionally small/controlled — the parent owns the value.
 */

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getProjectTaskOptions,
  type ProjectOption,
  type TaskOption,
} from "@/lib/time-tracking-api";

export function ProjectPicker({
  projects,
  value,
  onChange,
  disabled,
  placeholder = "Select a project",
  id,
}: {
  projects: ProjectOption[];
  value: string;
  onChange: (projectId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <div className="flex flex-col">
              <span className="font-medium">
                {p.projectNumber} — {p.title}
              </span>
              {p.clientName ? (
                <span className="text-xs text-muted-foreground">{p.clientName}</span>
              ) : null}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const NO_TASK = "__none__";

/**
 * Task picker scoped to a project. Loads the project's tasks on demand.
 * Emits `""` when "No task" is chosen so callers can omit `taskId`.
 */
export function TaskPicker({
  projectId,
  value,
  onChange,
  disabled,
  id,
}: {
  projectId: string;
  value: string;
  onChange: (taskId: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setTasks([]);
      return;
    }
    setLoading(true);
    getProjectTaskOptions(projectId)
      .then((list) => {
        if (!cancelled) setTasks(list);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <Select
      value={value || NO_TASK}
      onValueChange={(v) => onChange(v === NO_TASK ? "" : v)}
      disabled={disabled || !projectId}
    >
      <SelectTrigger id={id}>
        <SelectValue
          placeholder={
            !projectId
              ? "Select a project first"
              : loading
                ? "Loading tasks…"
                : "No task (project-level)"
          }
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_TASK}>No task (project-level)</SelectItem>
        {tasks.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
