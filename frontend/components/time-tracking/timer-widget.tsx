"use client";

/**
 * Timer widget for the dashboard top bar. When a timer is running it shows the
 * live elapsed clock + project/task with a Stop button. When idle it offers a
 * "Start timer" popover with project/task pickers + an optional note.
 *
 * Hidden for CLIENT users — the backend forbids CLIENT from logging time
 * (RolesGuard + service `assertCanWrite`), so showing the control would only
 * produce 403s.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Square, Clock, Loader2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { useAuthStore } from "@/lib/store";
import { useTimer } from "@/components/time-tracking/timer-provider";
import { ProjectPicker, TaskPicker } from "@/components/time-tracking/entity-pickers";
import { formatHms, getProjectOptions, type ProjectOption } from "@/lib/time-tracking-api";

export function TimerWidget() {
  const { user } = useAuthStore();
  const router = useRouter();
  const { toast } = useToast();
  const { running, elapsedSeconds, loading, start, stop } = useTimer();

  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [note, setNote] = useState("");
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  // Load project options lazily the first time the start popover opens.
  useEffect(() => {
    if (open && !projectsLoaded) {
      getProjectOptions()
        .then(setProjects)
        .catch(() => setProjects([]))
        .finally(() => setProjectsLoaded(true));
    }
  }, [open, projectsLoaded]);

  // Close popover on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // CLIENT can't log time; render nothing.
  if (user?.role === "CLIENT") return null;

  const handleStart = async () => {
    if (!projectId) {
      toast({
        title: "Pick a project",
        description: "Choose a project to start tracking time.",
        variant: "destructive",
      });
      return;
    }
    setStarting(true);
    try {
      await start({
        projectId,
        taskId: taskId || undefined,
        description: note.trim() || undefined,
      });
      toast({ title: "Timer started" });
      setOpen(false);
      setNote("");
      setTaskId("");
    } catch (e: any) {
      toast({
        title: "Couldn't start timer",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setStarting(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      const entry = await stop();
      const hrs = ((entry.durationSeconds ?? elapsedSeconds) / 3600).toFixed(2);
      toast({
        title: "Timer stopped",
        description: `Logged ${hrs}h to ${entry.project?.projectNumber ?? "project"}.`,
      });
    } catch (e: any) {
      toast({
        title: "Couldn't stop timer",
        description: e?.response?.data?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setStopping(false);
    }
  };

  // Running state — live clock + stop.
  if (running) {
    const label = running.task?.title || running.project?.projectNumber || "Tracking";
    return (
      <button
        type="button"
        onClick={() => router.push("/dashboard/time")}
        className="hidden sm:inline-flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors"
        title={`Tracking: ${running.project?.title ?? ""}${running.task ? " · " + running.task.title : ""}`}
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="font-mono tabular-nums">{formatHms(elapsedSeconds)}</span>
        <span className="max-w-[10rem] truncate text-emerald-700/80 dark:text-emerald-300/80">
          {label}
        </span>
        <span
          role="button"
          tabIndex={0}
          aria-label="Stop timer"
          onClick={(e) => {
            e.stopPropagation();
            if (!stopping) void handleStop();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              if (!stopping) void handleStop();
            }
          }}
          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded bg-emerald-500/20 hover:bg-rose-500/20 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
        >
          {stopping ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Square className="h-3 w-3 fill-current" />
          )}
        </span>
      </button>
    );
  }

  // Idle state — start popover.
  return (
    <div className="relative hidden sm:block" ref={popRef}>
      <Button
        variant="ghost"
        size="sm"
        className="text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        aria-label="Start a timer"
        disabled={loading}
      >
        <Clock className="h-4 w-4" />
        <span className="hidden md:inline">Start timer</span>
        <ChevronDown className="hidden h-3 w-3 md:inline" />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-border bg-popover p-4 shadow-lg">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Play className="h-4 w-4 text-emerald-500" />
            Start a timer
          </div>
          <div className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs">Project</Label>
              {!projectsLoaded ? (
                <div className="flex h-10 items-center rounded-md border border-input px-3 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading projects…
                </div>
              ) : projects.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  No projects available.
                </p>
              ) : (
                <ProjectPicker
                  projects={projects}
                  value={projectId}
                  onChange={(v) => {
                    setProjectId(v);
                    setTaskId("");
                  }}
                />
              )}
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Task (optional)</Label>
              <TaskPicker projectId={projectId} value={taskId} onChange={setTaskId} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Note (optional)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What are you working on?"
              />
            </div>
            <Button
              className="w-full"
              onClick={handleStart}
              disabled={starting || !projectId}
            >
              {starting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…
                </>
              ) : (
                <>
                  <Play className="mr-2 h-4 w-4" /> Start
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
