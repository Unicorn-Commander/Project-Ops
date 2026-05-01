/**
 * Single source of truth for the TaskType UI surface — label + icon pairing
 * for the dropdowns (create/edit modal), the icon pill on task cards, and
 * the kanban filter. Backed by the same enum the backend Prisma schema
 * uses.
 *
 * Before v1.6.13 the icon maps + labels were duplicated across 5 files
 * (kanban page, task-card, task-details modal, create-task modal,
 * edit-task modal) — and all five pointed at stale tax-domain TaskType
 * values that the backend no longer recognised. Centralising here.
 */

import type { ReactNode } from "react";
import {
  CheckSquare,
  Flag,
  Package,
  Eye,
  Users,
  Search,
  CircleDashed,
} from "lucide-react";
import { TaskType } from "./tasks-api";

export interface TaskTypeMeta {
  value: TaskType;
  label: string;
  icon: ReactNode;
}

const ICON_CLASS = "h-4 w-4";

export const TASK_TYPES: TaskTypeMeta[] = [
  { value: TaskType.TASK, label: "Task", icon: <CheckSquare className={ICON_CLASS} /> },
  { value: TaskType.MILESTONE, label: "Milestone", icon: <Flag className={ICON_CLASS} /> },
  { value: TaskType.DELIVERABLE, label: "Deliverable", icon: <Package className={ICON_CLASS} /> },
  { value: TaskType.REVIEW, label: "Review", icon: <Eye className={ICON_CLASS} /> },
  { value: TaskType.MEETING, label: "Meeting", icon: <Users className={ICON_CLASS} /> },
  { value: TaskType.RESEARCH, label: "Research", icon: <Search className={ICON_CLASS} /> },
  { value: TaskType.OTHER, label: "Other", icon: <CircleDashed className={ICON_CLASS} /> },
];

const META_BY_VALUE = new Map(TASK_TYPES.map((t) => [t.value, t]));

export function taskTypeLabel(value: TaskType | string | undefined): string {
  if (!value) return "Other";
  return META_BY_VALUE.get(value as TaskType)?.label ?? "Other";
}

export function taskTypeIcon(value: TaskType | string | undefined): ReactNode {
  if (!value) return <CircleDashed className={ICON_CLASS} />;
  return META_BY_VALUE.get(value as TaskType)?.icon ?? <CircleDashed className={ICON_CLASS} />;
}
