"use client";

import { Task } from "@/lib/tasks-api";
import { TaskCard } from "./task-card";

interface TaskListProps {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  emptyMessage?: string;
}

export function TaskList({ tasks, onTaskClick, emptyMessage = "No tasks found" }: TaskListProps) {
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
        <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
      ))}
    </div>
  );
}
