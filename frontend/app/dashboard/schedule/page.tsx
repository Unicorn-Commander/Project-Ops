"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { Gantt, type ScheduleProject } from "@/components/schedule/gantt";
import api from "@/lib/api";

export default function SchedulePage() {
  const [projects, setProjects] = useState<ScheduleProject[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(
          "/projects?page=1&limit=1000&sort=createdAt:desc",
        );
        if (cancelled) return;
        setProjects(res.data.data || []);
      } catch (err) {
        if (cancelled) return;
        toast({
          title: "Couldn't load schedule",
          description: "Project list fetch failed.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Schedule</h1>
        <p className="text-muted-foreground mt-1">
          Master timeline across every project. Bars run from project start
          to due date, coloured per project, with today marked in red.
          Filter by status, priority, or organization.
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
        <Gantt projects={projects} />
      )}
    </div>
  );
}
