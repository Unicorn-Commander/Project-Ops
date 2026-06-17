"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Task, TaskStatus, TaskPriority, TaskType } from "@/lib/tasks-api";
import { priorityTextClass } from "@/lib/badge-styles";
import { projectColorClasses } from "@/lib/project-colors";
import { Avatar } from "@/components/ui/avatar";
import { taskTypeIcon } from "@/lib/task-types";
import { TaskStatusUpdate } from "@/components/tasks/task-status-update";
import {
  Clock,
  AlertTriangle,
  CheckSquare as CheckSquareIcon,
  Pin as PinIcon,
} from "lucide-react";

interface TaskCardProps {
  task: Task;
  onClick: () => void;
  /** Optional refresh hook so an inline status change re-fetches list data. */
  onChange?: () => void;
  /** When provided, renders a selection checkbox + ring for bulk-action lists. */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** When provided, renders a pin toggle in the header (v1.6.54). */
  pinned?: boolean;
  onTogglePin?: () => void;
}

// Wrapped in React.memo: these cards render in long lists (My Tasks) and on
// the kanban board, where an unrelated state change (filter, drag, a sibling
// status update) would otherwise re-render every card. Props are primitives +
// stable callbacks, so referential equality is a good bail-out signal.
function TaskCardImpl({ task, onClick, onChange, selected, onToggleSelect, pinned, onTogglePin }: TaskCardProps) {
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
      role="button"
      tabIndex={0}
      aria-label={`Open task: ${task.title}`}
      onClick={onClick}
      onKeyDown={(e) => {
        // Enter / Space open the task — but only when the card itself is
        // focused, so activating a nested control (status select, pin,
        // checkbox) doesn't also fire the open handler.
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`p-4 hover:shadow-md transition-all cursor-pointer border-l-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
        isOverdue ? 'border-l-rose-500' : pc.borderLeft
      } ${pc.cardWash} ${selected ? "ring-2 ring-primary/60 ring-offset-1 ring-offset-background" : ""}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 flex-1">
          {onToggleSelect && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect();
              }}
              className="mt-1 shrink-0 h-5 w-5 rounded border border-border hover:border-primary inline-flex items-center justify-center transition-colors"
              aria-label={selected ? "Deselect task" : "Select task"}
            >
              {selected && (
                <CheckSquareIcon className="h-4 w-4 text-primary" strokeWidth={2.5} />
              )}
            </button>
          )}
          {onTogglePin && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              className="mt-1 shrink-0 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-muted/60 transition-colors"
              aria-label={pinned ? "Unpin task" : "Pin task"}
              title={pinned ? "Unpin" : "Pin to top of My Tasks"}
            >
              <PinIcon
                className={`h-4 w-4 ${
                  pinned
                    ? "fill-amber-400 text-amber-500 dark:text-amber-400"
                    : "text-muted-foreground/50 hover:text-muted-foreground"
                }`}
                strokeWidth={1.75}
              />
            </button>
          )}
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

        {/* Inline status — click to change without opening the modal. */}
        <TaskStatusUpdate
          taskId={task.id}
          currentStatus={task.status}
          onSuccess={onChange}
          compact
        />

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

export const TaskCard = React.memo(TaskCardImpl);
TaskCard.displayName = "TaskCard";
