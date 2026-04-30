"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Task, TaskStatus, TaskPriority, TaskType } from "@/lib/tasks-api";
import { statusBadgeClass, priorityTextClass } from "@/lib/badge-styles";
import {
  FileText,
  HelpCircle,
  Phone,
  Eye,
  Upload,
  CheckSquare,
  Clock,
  User,
  AlertTriangle,
} from "lucide-react";

interface TaskCardProps {
  task: Task;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== TaskStatus.COMPLETED;

  const getStatusColor = (status: TaskStatus) => statusBadgeClass(status);
  const getPriorityColor = (priority: TaskPriority) => priorityTextClass(priority);

  const getPriorityBorderColor = (priority: TaskPriority) => {
    const colors: Record<TaskPriority, string> = {
      [TaskPriority.LOW]: "border-l-gray-400",
      [TaskPriority.MEDIUM]: "border-l-blue-500",
      [TaskPriority.HIGH]: "border-l-orange-500",
      [TaskPriority.URGENT]: "border-l-red-500",
    };
    return colors[priority] || "border-l-gray-400";
  };

  const getTypeIcon = (type: TaskType) => {
    const icons: Record<TaskType, React.ReactElement> = {
      [TaskType.DOCUMENT_REQUEST]: <FileText className="h-4 w-4" />,
      [TaskType.QUESTION]: <HelpCircle className="h-4 w-4" />,
      [TaskType.IRS_CALL]: <Phone className="h-4 w-4" />,
      [TaskType.REVIEW]: <Eye className="h-4 w-4" />,
      [TaskType.FILING]: <Upload className="h-4 w-4" />,
      [TaskType.OTHER]: <CheckSquare className="h-4 w-4" />,
    };
    return icons[type] || <CheckSquare className="h-4 w-4" />;
  };

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

  return (
    <Card
      className={`p-4 hover:shadow-md transition-all cursor-pointer border-l-4 ${getPriorityBorderColor(
        task.priority
      )} ${isOverdue ? 'bg-red-50' : ''}`}
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
      <div className="flex items-center gap-4 flex-wrap">
        {/* Status Badge */}
        <Badge className={getStatusColor(task.status)}>
          {task.status.replace(/_/g, ' ')}
        </Badge>

        {/* Priority */}
        <div className="flex items-center gap-1">
          <span className={`text-xs font-semibold ${getPriorityColor(task.priority)}`}>
            {task.priority}
          </span>
        </div>

        {/* Assigned To */}
        {task.assignedTo && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>
              {task.assignedTo.firstName && task.assignedTo.lastName
                ? `${task.assignedTo.firstName} ${task.assignedTo.lastName}`
                : task.assignedTo.email}
            </span>
          </div>
        )}

        {/* Due Date */}
        {task.dueDate && (
          <div className={`flex items-center gap-1 text-xs ${isOverdue ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>
            {isOverdue && <AlertTriangle className="h-3 w-3" />}
            <Clock className="h-3 w-3" />
            <span>{formatDueDate(task.dueDate)}</span>
          </div>
        )}

        {/* Project Info */}
        {task.project && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="font-mono">{task.project?.projectNumber}</span>
            <span>•</span>
            <span>{task.project.clientName}</span>
          </div>
        )}

        {/* Comments Count */}
        {task._count && task._count.comments > 0 && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{task._count.comments} comment{task._count.comments !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
