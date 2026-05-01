"use client";

import { Card } from "@/components/ui/card";
import { Task, TaskStatus, TaskPriority, TaskType } from "@/lib/tasks-api";
import { priorityTextClass, statusSolidClass } from "@/lib/badge-styles";
import { projectColorClasses } from "@/lib/project-colors";
import { Avatar } from "@/components/ui/avatar";
import { taskTypeIcon } from "@/lib/task-types";
import {
  Clock,
  AlertTriangle,
} from "lucide-react";

interface TaskCardProps {
  task: Task;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== TaskStatus.COMPLETED;
  const pc = projectColorClasses(task.projectId);

  const getPriorityColor = (priority: TaskPriority) => priorityTextClass(priority);

  // Icon mapping centralised in lib/task-types.tsx (v1.6.13).
  const getTypeIcon = (type: TaskType) => taskTypeIcon(type);

  const formatDueDate = (date: string) => {
    const dueDate = new Date(date);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (dueDate.toDateString() === today.toDateString()) {
      return "Due Today";
    } else if (dueDate.toDateString() === tomorrow.toDateString()) {
      return "Due Tomorrow";
    } else {
      return `Due ${dueDate.toLocaleDateString()}`;
    }
  };

  // Per-project colour stripe (overdue rose still wins so urgency reads loud)
  // + faint full-card wash matching the project hue. Same treatment as the
  // kanban + dashboard for visual continuity.
  return (
    <Card
      className={`p-4 hover:shadow-md transition-all cursor-pointer border-l-4 ${
        isOverdue ? 'border-l-rose-500' : pc.borderLeft
      } ${pc.cardWash}`}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 flex-1">
          <div className="mt-1">
            {getTypeIcon(task.type)}
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground mb-1 line-clamp-1">
              {task.title}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-2">
              {task.description}
            </p>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Project pill — same chip-with-dot style as kanban cards */}
        {task.project && (
          <span className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium ${pc.badgeBg} ${pc.badgeText}`}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${pc.dot}`} />
            {task.project.projectNumber}
          </span>
        )}

        {/* Hive-style solid status pill */}
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusSolidClass(task.status)}`}>
          {task.status.replace(/_/g, ' ')}
        </span>

        {/* Priority — text-only, since the solid status pill carries the visual weight */}
        <span className={`text-xs font-semibold ${getPriorityColor(task.priority)}`}>
          {task.priority}
        </span>

        {/* Assigned To */}
        {task.assignedTo && (() => {
          const fullName =
            task.assignedTo.firstName && task.assignedTo.lastName
              ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}`
              : task.assignedTo.email;
          return (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Avatar name={fullName} size={20} />
              <span className="truncate">{fullName}</span>
            </div>
          );
        })()}

        {/* Due Date */}
        {task.dueDate && (
          <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-muted-foreground'}`}>
            {isOverdue && <AlertTriangle className="h-3 w-3" />}
            <Clock className="h-3 w-3" />
            <span>{formatDueDate(task.dueDate)}</span>
          </div>
        )}

        {/* Project title */}
        {task.project && (
          <span className="text-xs text-muted-foreground truncate">
            {task.project.title}
          </span>
        )}

        {/* Comments Count */}
        {task._count && task._count.comments > 0 && (
          <span className="text-xs text-muted-foreground">
            {task._count.comments} comment{task._count.comments !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </Card>
  );
}
