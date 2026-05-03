"use client";

import { Task } from "@/lib/tasks-api";
import { TaskCard } from "./task-card";

interface TaskListProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  /** Optional: called when an inline edit (e.g. status change) succeeds. */
  onTaskChange?: () => void;
  /** Optional: bulk-selection set + toggle. If both omitted, no checkbox UI. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  /** Optional: pin set + toggle. If both omitted, no pin UI. (v1.6.54) */
  pinnedIds?: Set<string>;
  onTogglePin?: (id: string) => void;
  emptyMessage?: string;
}

export function TaskList({
  tasks,
  onTaskClick,
  onTaskChange,
  selectedIds,
  onToggleSelect,
  pinnedIds,
  onTogglePin,
  emptyMessage = "No tasks found",
}: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onClick={() => onTaskClick(task)}
          onChange={onTaskChange}
          selected={selectedIds?.has(task.id)}
          onToggleSelect={onToggleSelect ? () => onToggleSelect(task.id) : undefined}
          pinned={pinnedIds?.has(task.id)}
          onTogglePin={onTogglePin ? () => onTogglePin(task.id) : undefined}
        />
      ))}
    </div>
  );
}
