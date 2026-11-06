import { isDateOnlyBeforeToday } from "./date-only.ts";

export interface OverdueTask {
  dueDate: string | Date | null;
  status: string;
}

/** Completed and cancelled work is historical, never overdue work. */
export function isTaskOverdue(task: OverdueTask, now: Date = new Date()): boolean {
  return (
    task.dueDate !== null &&
    task.status !== "COMPLETED" &&
    task.status !== "CANCELLED" &&
    isDateOnlyBeforeToday(task.dueDate, now)
  );
}
