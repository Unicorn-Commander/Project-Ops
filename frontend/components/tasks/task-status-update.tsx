"use client";

/**
 * Inline status dropdown for a task — same UX as the project's
 * `<StatusUpdate>` component but pointed at the Task entity. Used on
 * task cards in My Tasks / Project detail / Kanban filter panels so
 * the operator can move a task forward without opening the modal.
 *
 * Stops click propagation so it doesn't fight the row's open-modal
 * onClick handler that the surrounding TaskCard wires up.
 */

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { updateTaskStatus, TaskStatus } from "@/lib/tasks-api";
import { statusBadgeClass } from "@/lib/badge-styles";

interface TaskStatusUpdateProps {
  taskId: string;
  currentStatus: TaskStatus;
  onSuccess?: () => void;
  disabled?: boolean;
  /**
   * Compact = pill-only trigger sized to fit inline in a card row;
   * default = full select trigger like the projects list.
   */
  compact?: boolean;
}

const TASK_STATUSES: { value: TaskStatus; label: string }[] = [
  { value: TaskStatus.PENDING,            label: "Pending" },
  { value: TaskStatus.IN_PROGRESS,        label: "In Progress" },
  { value: TaskStatus.WAITING_FOR_CLIENT, label: "Waiting for Client" },
  { value: TaskStatus.COMPLETED,          label: "Completed" },
  { value: TaskStatus.CANCELLED,          label: "Cancelled" },
];

export function TaskStatusUpdate({
  taskId,
  currentStatus,
  onSuccess,
  disabled = false,
  compact = false,
}: TaskStatusUpdateProps) {
  const [status, setStatus] = useState<TaskStatus>(currentStatus);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleChange = async (raw: string) => {
    const next = raw as TaskStatus;
    if (next === status) return;
    setLoading(true);
    try {
      await updateTaskStatus(taskId, next);
      setStatus(next);
      toast({
        title: "Status updated",
        description: `Task moved to ${TASK_STATUSES.find((s) => s.value === next)?.label}`,
      });
      onSuccess?.();
    } catch (err: any) {
      toast({
        title: "Couldn't update status",
        description: err?.response?.data?.message ?? "Server rejected the change.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const currentLabel = TASK_STATUSES.find((s) => s.value === status)?.label ?? status;

  return (
    // Stop bubbling so the parent TaskCard's onClick doesn't open the
    // modal when the user is just changing status.
    <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <Select value={status} onValueChange={handleChange} disabled={loading || disabled}>
        <SelectTrigger
          className={
            compact
              ? "h-7 px-2 py-0 border-0 bg-transparent shadow-none gap-1 hover:bg-muted/50 [&>svg]:opacity-50"
              : "w-[160px] h-8"
          }
        >
          <SelectValue>
            <span
              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${statusBadgeClass(status)}`}
            >
              {currentLabel}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TASK_STATUSES.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10.5px] font-medium ${statusBadgeClass(opt.value)}`}
              >
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
