import { AutomationTrigger } from '@prisma/client';

/**
 * The automations / rules-engine domain model.
 *
 * A rule is `{ trigger, conditions[], actions[] }`. When a domain event whose
 * trigger matches fires, the engine evaluates EVERY condition (AND semantics)
 * against the event payload; if they all match, it executes the actions in
 * order. Conditions + actions are stored as Prisma `Json` on AutomationRule and
 * validated into these shapes on write (controller) and re-validated on read
 * (listener) — a hand-edited / legacy row that no longer matches is skipped
 * rather than crashing the engine.
 */

// ── Conditions ──────────────────────────────────────────────────────────────

/** Supported comparison operators for a condition. */
export const CONDITION_OPS = ['eq', 'neq', 'contains', 'gt', 'lt'] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/**
 * A single condition: compare `field` (a dotted path resolved against the event
 * payload, e.g. `priority`, `toStatus`, `task.projectId`) with `value` using
 * `op`. All of a rule's conditions must pass (logical AND) for it to fire; an
 * empty/absent conditions array means "always".
 */
export interface AutomationCondition {
  field: string;
  op: ConditionOp;
  value: unknown;
}

// ── Actions ───────────────────────────────────────────────────────────────

/** Supported action types. */
export const ACTION_TYPES = [
  'assign_task',
  'set_status',
  'add_comment',
  'create_task',
  'notify',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** `{ type, params }` — the params shape depends on `type` (validated per-type). */
export interface AutomationAction {
  type: ActionType;
  params: Record<string, unknown>;
}

// ── Event payloads (the domain-event contract the engine consumes) ──────────

/**
 * Common fields every automation event carries. `workspaceId` scopes the rule
 * lookup + execution RLS; `actorId` is the local User.id of whoever caused the
 * event (used only for attribution / self-action checks). `task`/`project` are
 * the affected entity (used for condition evaluation + action targeting).
 */
interface BaseAutomationEvent {
  workspaceId: string;
  actorId?: string | null;
  /**
   * Set by the engine on events IT caused (action-initiated mutations). Used as
   * a belt-and-suspenders companion to the AsyncLocalStorage depth guard for
   * events that cross an async/event-loop boundary the ALS context can't span.
   */
  __automation?: { depth: number };
}

export interface TaskCreatedEvent extends BaseAutomationEvent {
  taskId: string;
  projectId?: string | null;
  task?: Record<string, unknown> | null;
}

export interface TaskStatusChangedEvent extends BaseAutomationEvent {
  taskId: string;
  projectId?: string | null;
  fromStatus?: string | null;
  toStatus: string;
  task?: Record<string, unknown> | null;
}

export interface TaskAssignedEvent extends BaseAutomationEvent {
  taskId: string;
  assignedToId: string;
  task?: Record<string, unknown> | null;
}

export interface TaskCompletedEvent extends BaseAutomationEvent {
  taskId: string;
  projectId?: string | null;
  task?: Record<string, unknown> | null;
}

export interface ProjectCreatedEvent extends BaseAutomationEvent {
  projectId: string;
  project?: Record<string, unknown> | null;
}

export interface ProjectStatusChangedEvent extends BaseAutomationEvent {
  projectId: string;
  fromStatus?: string | null;
  toStatus: string;
  project?: Record<string, unknown> | null;
}

export interface CommentCreatedEvent extends BaseAutomationEvent {
  taskId: string;
  commentId: string;
  authorId: string;
  content: string;
}

/** Any event the engine can evaluate (the union it accepts). */
export type AutomationEvent =
  | TaskCreatedEvent
  | TaskStatusChangedEvent
  | TaskAssignedEvent
  | TaskCompletedEvent
  | ProjectCreatedEvent
  | ProjectStatusChangedEvent
  | CommentCreatedEvent;

/** Map a trigger to its event payload (documentation aid for handlers). */
export type EventForTrigger<T extends AutomationTrigger> = T extends 'TASK_CREATED'
  ? TaskCreatedEvent
  : T extends 'TASK_STATUS_CHANGED'
    ? TaskStatusChangedEvent
    : T extends 'TASK_ASSIGNED'
      ? TaskAssignedEvent
      : T extends 'TASK_COMPLETED'
        ? TaskCompletedEvent
        : T extends 'PROJECT_CREATED'
          ? ProjectCreatedEvent
          : T extends 'PROJECT_STATUS_CHANGED'
            ? ProjectStatusChangedEvent
            : T extends 'COMMENT_CREATED'
              ? CommentCreatedEvent
              : AutomationEvent;
