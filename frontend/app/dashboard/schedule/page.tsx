"use client";

import { useEffect, useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Gantt, type ScheduleProject } from "@/components/schedule/gantt";
import api from "@/lib/api";
import { format } from "date-fns";

export default function SchedulePage() {
  const [projects, setProjects] = useState<ScheduleProject[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get(
        "/projects?page=1&limit=1000&sortBy=createdAt&sortDir=desc",
      );
      setProjects(res.data.data || []);
    } catch (err) {
      toast({
        title: "Couldn't load schedule",
        description: "Project list fetch failed.",
        variant: "destructive",
      });
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await fetchProjects();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchProjects]);

  // Drag-to-reschedule handler — optimistic local update + PATCH (v1.6.36).
  const handleReschedule = useCallback(
    async (projectId: string, newDueDate: Date) => {
      const original = projects.find((p) => p.id === projectId);
      if (!original) return;
      const newIso = newDueDate.toISOString();
      // Optimistic: shift the local row immediately so the bar settles
      // at the new position even before the server responds.
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, dueDate: newIso } : p)),
      );
      try {
        await api.patch(`/projects/${projectId}`, { dueDate: newIso });
        toast({
          title: "Project rescheduled",
          description: `${original.projectNumber} due ${format(newDueDate, "MMM d, yyyy")}`,
        });
      } catch (err: any) {
        // Revert on failure.
        setProjects((prev) =>
          prev.map((p) => (p.id === projectId ? { ...p, dueDate: original.dueDate } : p)),
        );
        toast({
          title: "Couldn't save new due date",
          description:
            err?.response?.data?.message ??
            "The server rejected the change. The schedule has been reverted.",
          variant: "destructive",
        });
      }
    },
    [projects, toast],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Master Schedule</h1>
        <p className="text-muted-foreground mt-1">
          Every project on one timeline — grouped by customer, product, owner,
          or status. Bars carry live progress; diamonds mark due dates. Drag a
          bar to reschedule, zoom the window, or filter the portfolio.
        </p>
      </div>

      {loading ? (
        <Card className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-24" />
          </div>
          <SkeletonText lines={6} />
        </Card>
      ) : (
        <Gantt projects={projects} onReschedule={handleReschedule} />
      )}
    </div>
  );
}
