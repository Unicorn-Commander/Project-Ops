import api from "./api";
import { TaskPriority, TaskStatus } from "./tasks-api";

/**
 * Automations / rules-engine API client.
 *
 * Mirrors the backend `automations` module exactly (see
 * backend/src/automations). A rule is `{ trigger, conditions[], actions[] }`:
 * when a domain event whose trigger matches fires, the engine evaluates EVERY
 * condition (logical AND) against the event payload, and if they all pass it
 * runs the actions in order.
 *
 * The backend stores `conditions`/`actions` as Prisma `Json` and validates
 * their shape on write, so this client sends/receives them as typed arrays.
 * Auth + the active `X-Workspace-Id` header are injected by the shared axios
 * instance, so every call is already scoped to the user's active workspace.
 *
 * NOTE: every automations route is an ADMIN/MANAGER surface server-side
 * (Roles guard); a STAFF/CLIENT caller gets a 403.
 */

// ── Triggers ────────────────────────────────────────────────────────────────

/** The domain events a rule can fire on (Prisma `AutomationTrigger`). */
export const AUTOMATION_TRIGGERS = [
  "TASK_CREATED",
  "TASK_STATUS_CHANGED",
  "TASK_ASSIGNED",
  "TASK_COMPLETED",
  "PROJECT_CREATED",
  "PROJECT_STATUS_CHANGED",
  "COMMENT_CREATED",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

// ── Conditions ────────────────────────────────────────────────────────────

/** Supported comparison operators for a condition. */
export const CONDITION_OPS = ["eq", "neq", "contains", "gt", "lt"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

/**
 * A single condition: compare `field` (a dotted path resolved against the
 * event payload, e.g. `priority`, `toStatus`, `task.projectId`) against
 * `value` using `op`. All of a rule's conditions must pass (AND); an empty
 * array means "always".
 */
export interface AutomationCondition {
  field: string;
  op: ConditionOp;
  value: unknown;
}

// ── Actions ───────────────────────────────────────────────────────────────

/** Supported action types (Prisma-validated server-side). */
export const ACTION_TYPES = [
  "assign_task",
  "set_status",
  "add_comment",
  "create_task",
  "notify",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** `{ type, params }` — the params shape depends on `type`. */
export interface AutomationAction {
  type: ActionType;
  params: Record<string, unknown>;
}

// Strongly-typed params per action type — used by the builder to render the
// right inputs and by the summary builder to read fields safely.
export interface AssignTaskParams {
  userId: string;
}
export interface SetStatusParams {
  status: TaskStatus;
}
export interface AddCommentParams {
  text: string;
}
export interface CreateTaskParams {
  title: string;
  priority?: TaskPriority;
  projectId?: string;
}
export interface NotifyParams {
  userId: string;
  message?: string;
}

// ── Rule ────────────────────────────────────────────────────────────────────

/**
 * An automation rule as returned by the API. `conditions`/`actions` come back
 * as the raw JSON the engine stored; they're typed here as the validated
 * shapes (the backend rejects malformed bodies on write).
 */
export interface AutomationRule {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdById: string;
  lastRunAt: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Body for POST /automations. `enabled` defaults to true server-side. */
export interface CreateAutomationRuleData {
  name: string;
  enabled?: boolean;
  trigger: AutomationTrigger;
  conditions?: AutomationCondition[];
  actions: AutomationAction[];
}

/** Body for PATCH /automations/:id — every field optional. */
export type UpdateAutomationRuleData = Partial<CreateAutomationRuleData>;

export interface ListAutomationsParams {
  trigger?: AutomationTrigger;
  enabled?: boolean;
}

/**
 * Normalize a raw rule from the API: `conditions` can be null/absent (the
 * Prisma column is nullable) and either array may legitimately be empty, so
 * coerce both to arrays for safe rendering.
 */
function normalizeRule(raw: any): AutomationRule {
  return {
    ...raw,
    conditions: Array.isArray(raw?.conditions) ? raw.conditions : [],
    actions: Array.isArray(raw?.actions) ? raw.actions : [],
  } as AutomationRule;
}

// ── CRUD ──────────────────────────────────────────────────────────────────

/** List the rules in the active workspace (newest first). */
export const getAutomations = async (
  params?: ListAutomationsParams,
): Promise<AutomationRule[]> => {
  const response = await api.get("/automations", { params });
  const list = Array.isArray(response.data) ? response.data : (response.data?.data ?? []);
  return list.map(normalizeRule);
};

/** Get one rule by id (404 when not visible in the active workspace). */
export const getAutomation = async (id: string): Promise<AutomationRule> => {
  const response = await api.get(`/automations/${id}`);
  return normalizeRule(response.data);
};

/** Create a rule. 400 on a malformed actions/conditions shape. */
export const createAutomation = async (
  data: CreateAutomationRuleData,
): Promise<AutomationRule> => {
  const response = await api.post("/automations", data);
  return normalizeRule(response.data);
};

/** Patch a rule (only provided fields change). 404 when not in workspace. */
export const updateAutomation = async (
  id: string,
  data: UpdateAutomationRuleData,
): Promise<AutomationRule> => {
  const response = await api.patch(`/automations/${id}`, data);
  return normalizeRule(response.data);
};

/** Toggle a rule's enabled flag — thin convenience over updateAutomation. */
export const setAutomationEnabled = async (
  id: string,
  enabled: boolean,
): Promise<AutomationRule> => updateAutomation(id, { enabled });

/** Delete a rule. 404 when not in workspace. */
export const deleteAutomation = async (id: string): Promise<void> => {
  await api.delete(`/automations/${id}`);
};
