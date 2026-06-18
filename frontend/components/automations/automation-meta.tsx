"use client";

import {
  AlarmClock,
  ArrowRightLeft,
  CheckCircle2,
  FilePlus2,
  FolderPlus,
  MessageSquarePlus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { TaskPriority, TaskStatus } from "@/lib/tasks-api";
import {
  ACTION_TYPES,
  AUTOMATION_TRIGGERS,
  CONDITION_OPS,
  type ActionType,
  type AutomationAction,
  type AutomationCondition,
  type AutomationTrigger,
  type ConditionOp,
} from "@/lib/automations-api";

/**
 * Friendly, human-facing metadata for the rules engine — the single source of
 * truth shared by the rule cards, the builder, and the summary/preview string.
 *
 * Keeping triggers / ops / actions / fields described in one place means the
 * "When … if … then …" sentence the user reads on a card is built from exactly
 * the same labels the builder offers, so nothing ever drifts.
 */

// ── Triggers ────────────────────────────────────────────────────────────────

export interface TriggerMeta {
  value: AutomationTrigger;
  /** Noun phrase for menus, e.g. "Task created". */
  label: string;
  /** Verb clause for the sentence, e.g. "a task is created". */
  clause: string;
  icon: LucideIcon;
  /** Tailwind text-tone for the trigger badge. */
  tone: string;
}

export const TRIGGER_META: Record<AutomationTrigger, TriggerMeta> = {
  TASK_CREATED: {
    value: "TASK_CREATED",
    label: "Task created",
    clause: "a task is created",
    icon: FilePlus2,
    tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  TASK_STATUS_CHANGED: {
    value: "TASK_STATUS_CHANGED",
    label: "Task status changed",
    clause: "a task's status changes",
    icon: ArrowRightLeft,
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  TASK_ASSIGNED: {
    value: "TASK_ASSIGNED",
    label: "Task assigned",
    clause: "a task is assigned",
    icon: UserPlus,
    tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
  TASK_COMPLETED: {
    value: "TASK_COMPLETED",
    label: "Task completed",
    clause: "a task is completed",
    icon: CheckCircle2,
    tone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  PROJECT_CREATED: {
    value: "PROJECT_CREATED",
    label: "Project created",
    clause: "a project is created",
    icon: FolderPlus,
    tone: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
  PROJECT_STATUS_CHANGED: {
    value: "PROJECT_STATUS_CHANGED",
    label: "Project status changed",
    clause: "a project's status changes",
    icon: ArrowRightLeft,
    tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  },
  COMMENT_CREATED: {
    value: "COMMENT_CREATED",
    label: "Comment posted",
    clause: "a comment is posted",
    icon: MessageSquarePlus,
    tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  },
};

export const TRIGGER_OPTIONS = AUTOMATION_TRIGGERS.map((t) => TRIGGER_META[t]);

// ── Condition ops ────────────────────────────────────────────────────────────

export const OP_LABEL: Record<ConditionOp, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  gt: "is greater than",
  lt: "is less than",
};

export const OP_OPTIONS = CONDITION_OPS.map((op) => ({ value: op, label: OP_LABEL[op] }));

// ── Condition fields (per trigger) ───────────────────────────────────────────

export type FieldKind = "status" | "priority" | "text";

export interface FieldMeta {
  /** The dotted payload path stored on the condition. */
  value: string;
  label: string;
  /** Drives which value editor the builder shows + which ops make sense. */
  kind: FieldKind;
  hint?: string;
}

const FIELD_PRIORITY: FieldMeta = {
  value: "priority",
  label: "Priority",
  kind: "priority",
};
const FIELD_TO_STATUS: FieldMeta = {
  value: "toStatus",
  label: "New status",
  kind: "status",
  hint: "The status the item changed to",
};
const FIELD_FROM_STATUS: FieldMeta = {
  value: "fromStatus",
  label: "Previous status",
  kind: "status",
  hint: "The status the item changed from",
};
const FIELD_TASK_PROJECT: FieldMeta = {
  value: "task.projectId",
  label: "Project (task)",
  kind: "text",
  hint: "Match the task's project id",
};
const FIELD_COMMENT_CONTENT: FieldMeta = {
  value: "content",
  label: "Comment text",
  kind: "text",
};

/**
 * The condition fields that make sense for each trigger's event payload. The
 * builder offers these; an existing rule can still carry a hand-authored field
 * not in this list, which we render as a free-text path so nothing is lost.
 */
export const FIELDS_BY_TRIGGER: Record<AutomationTrigger, FieldMeta[]> = {
  TASK_CREATED: [FIELD_PRIORITY, FIELD_TASK_PROJECT],
  TASK_STATUS_CHANGED: [FIELD_TO_STATUS, FIELD_FROM_STATUS, FIELD_PRIORITY, FIELD_TASK_PROJECT],
  TASK_ASSIGNED: [FIELD_PRIORITY, FIELD_TASK_PROJECT],
  TASK_COMPLETED: [FIELD_PRIORITY, FIELD_TASK_PROJECT],
  PROJECT_CREATED: [{ value: "project.status", label: "Status", kind: "status" }],
  PROJECT_STATUS_CHANGED: [FIELD_TO_STATUS, FIELD_FROM_STATUS],
  COMMENT_CREATED: [FIELD_COMMENT_CONTENT],
};

export function fieldMetaFor(trigger: AutomationTrigger, field: string): FieldMeta | undefined {
  return FIELDS_BY_TRIGGER[trigger]?.find((f) => f.value === field);
}

// ── Actions ───────────────────────────────────────────────────────────────

export interface ActionMeta {
  value: ActionType;
  label: string;
  /** Verb clause for the sentence, e.g. "assign the task to …". */
  verb: string;
  icon: LucideIcon;
  tone: string;
  description: string;
}

export const ACTION_META: Record<ActionType, ActionMeta> = {
  assign_task: {
    value: "assign_task",
    label: "Assign the task",
    verb: "assign the task to",
    icon: UserPlus,
    tone: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
    description: "Set the task's assignee.",
  },
  set_status: {
    value: "set_status",
    label: "Set the task status",
    verb: "set the task status to",
    icon: ArrowRightLeft,
    tone: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
    description: "Move the task to a new status.",
  },
  add_comment: {
    value: "add_comment",
    label: "Add a comment",
    verb: "add a comment",
    icon: MessageSquarePlus,
    tone: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    description: "Post a comment on the task.",
  },
  create_task: {
    value: "create_task",
    label: "Create a task",
    verb: "create a task",
    icon: FilePlus2,
    tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
    description: "Create a brand-new task.",
  },
  notify: {
    value: "notify",
    label: "Notify someone",
    verb: "notify",
    icon: AlarmClock,
    tone: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
    description: "Send an in-app notification to a user.",
  },
};

export const ACTION_OPTIONS = ACTION_TYPES.map((t) => ACTION_META[t]);

// ── Enum value labels ────────────────────────────────────────────────────────

/** Turn an UPPER_SNAKE enum value into Title Case for display. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const TASK_STATUS_OPTIONS = Object.values(TaskStatus).map((value) => ({
  value,
  label: humanizeEnum(value),
}));

export const TASK_PRIORITY_OPTIONS = Object.values(TaskPriority).map((value) => ({
  value,
  label: humanizeEnum(value),
}));

// ── Default params for a freshly-picked action type ──────────────────────────

export function defaultParamsFor(type: ActionType): Record<string, unknown> {
  switch (type) {
    case "assign_task":
      return { userId: "" };
    case "set_status":
      return { status: "" };
    case "add_comment":
      return { text: "" };
    case "create_task":
      return { title: "", priority: "", projectId: "" };
    case "notify":
      return { userId: "", message: "" };
    default:
      return {};
  }
}

// ── Human-readable summary ("When … if … then …") ────────────────────────────

export interface NameLookups {
  /** id → display name for users (assignee / notify target). */
  userName: (id: string) => string;
  /** id → display name for projects (create_task.projectId). */
  projectName: (id: string) => string;
}

function valueToText(value: unknown): string {
  if (value == null || value === "") return '""';
  if (typeof value === "boolean") return value ? "true" : "false";
  const s = String(value);
  // Surface enum-ish values as Title Case (HIGH → High, IN_PROGRESS → In Progress).
  return /^[A-Z][A-Z0-9_]*$/.test(s) ? humanizeEnum(s) : s;
}

/** One condition rendered as "Priority is High". */
export function describeCondition(
  trigger: AutomationTrigger,
  c: AutomationCondition,
): string {
  const meta = fieldMetaFor(trigger, c.field);
  const fieldLabel = meta?.label ?? c.field;
  return `${fieldLabel} ${OP_LABEL[c.op] ?? c.op} ${valueToText(c.value)}`;
}

/** One action rendered as "notify Dana Lee" / "set the task status to Completed". */
export function describeAction(a: AutomationAction, names: NameLookups): string {
  const verb = ACTION_META[a.type]?.verb ?? a.type;
  const p = a.params ?? {};
  switch (a.type) {
    case "assign_task":
      return `${verb} ${names.userName(String(p.userId ?? ""))}`;
    case "notify": {
      const who = names.userName(String(p.userId ?? ""));
      return p.message ? `${verb} ${who} ("${String(p.message)}")` : `${verb} ${who}`;
    }
    case "set_status":
      return `${verb} ${valueToText(p.status)}`;
    case "add_comment": {
      const text = String(p.text ?? "");
      const trimmed = text.length > 40 ? `${text.slice(0, 40)}…` : text;
      return `${verb} ("${trimmed}")`;
    }
    case "create_task": {
      const title = String(p.title ?? "");
      const where = p.projectId ? ` in ${names.projectName(String(p.projectId))}` : "";
      return `${verb} "${title}"${where}`;
    }
    default:
      return verb;
  }
}

/**
 * Build the full plain-English sentence for a rule, e.g.
 * "When a task is completed, if Priority is High → notify Dana Lee".
 */
export function describeRule(
  rule: {
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  },
  names: NameLookups,
): string {
  const when = `When ${TRIGGER_META[rule.trigger]?.clause ?? rule.trigger}`;
  const conds =
    rule.conditions.length > 0
      ? `, if ${rule.conditions.map((c) => describeCondition(rule.trigger, c)).join(" and ")}`
      : "";
  const acts =
    rule.actions.length > 0
      ? rule.actions.map((a) => describeAction(a, names)).join(", then ")
      : "do nothing";
  return `${when}${conds} → ${acts}`;
}
