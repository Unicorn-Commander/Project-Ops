"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { getTask } from "@/lib/tasks-api";

export default function TaskRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!taskId) {
      setNotFound(true);
      return () => {
        cancelled = true;
      };
    }

    getTask(taskId)
      .then((task) => {
        if (!cancelled) {
          router.replace(
            `/dashboard/projects/${task.projectId}?taskId=${encodeURIComponent(task.id)}`,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });

    return () => {
      cancelled = true;
    };
  }, [router, taskId]);

  if (notFound) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Card className="w-full max-w-sm p-6 text-center">
          <p className="text-sm text-muted-foreground">Task not found</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading task...</p>
    </div>
  );
}
