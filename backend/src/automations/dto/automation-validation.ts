import { ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { ACTION_TYPES, ActionType, CONDITION_OPS } from '../automation.types';

/**
 * Custom class-validator constraints for the `actions` and `conditions` arrays.
 * They run at the DTO layer so a malformed automation body is rejected with a
 * 400 (descriptive message) BEFORE it is ever persisted — the engine then only
 * ever loads well-formed rules. Validation here mirrors the runtime shape
 * checks in the engine (defense in depth: a hand-edited DB row is still skipped
 * at run time rather than crashing the listener).
 */

const TASK_STATUSES = Object.values(TaskStatus) as string[];
const TASK_PRIORITIES = Object.values(TaskPriority) as string[];

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Validate ONE action's params by type. Returns an error string or null. */
export function validateActionParams(type: ActionType, params: any): string | null {
  if (params == null || typeof params !== 'object' || Array.isArray(params)) {
    return `action "${type}" requires a params object`;
  }
  switch (type) {
    case 'assign_task':
      if (!isNonEmptyString(params.userId)) return 'assign_task requires params.userId (string)';
      return null;
    case 'set_status':
      if (!isNonEmptyString(params.status)) return 'set_status requires params.status (string)';
      if (!TASK_STATUSES.includes(params.status))
        return `set_status.status must be one of ${TASK_STATUSES.join(', ')}`;
      return null;
    case 'add_comment':
      if (!isNonEmptyString(params.text)) return 'add_comment requires params.text (string)';
      return null;
    case 'create_task':
      if (!isNonEmptyString(params.title)) return 'create_task requires params.title (string)';
      if (params.priority != null && !TASK_PRIORITIES.includes(params.priority))
        return `create_task.priority must be one of ${TASK_PRIORITIES.join(', ')}`;
      if (params.projectId != null && !isNonEmptyString(params.projectId))
        return 'create_task.projectId must be a string when provided';
      return null;
    case 'notify':
      if (!isNonEmptyString(params.userId)) return 'notify requires params.userId (string)';
      if (params.message != null && typeof params.message !== 'string')
        return 'notify.message must be a string when provided';
      return null;
    default:
      return `unknown action type "${type}"`;
  }
}

@ValidatorConstraint({ name: 'isAutomationActionArray', async: false })
export class IsAutomationActionArray implements ValidatorConstraintInterface {
  private message = 'actions must be a non-empty array of {type, params}';

  validate(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) {
      this.message = 'actions must be a non-empty array';
      return false;
    }
    for (let i = 0; i < value.length; i++) {
      const a = value[i] as any;
      if (a == null || typeof a !== 'object' || Array.isArray(a)) {
        this.message = `actions[${i}] must be an object {type, params}`;
        return false;
      }
      if (!(ACTION_TYPES as readonly string[]).includes(a.type)) {
        this.message = `actions[${i}].type must be one of ${ACTION_TYPES.join(', ')}`;
        return false;
      }
      const paramErr = validateActionParams(a.type, a.params);
      if (paramErr) {
        this.message = `actions[${i}]: ${paramErr}`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return this.message;
  }
}

@ValidatorConstraint({ name: 'isAutomationConditionArray', async: false })
export class IsAutomationConditionArray implements ValidatorConstraintInterface {
  private message = 'conditions must be an array of {field, op, value}';

  validate(value: unknown): boolean {
    if (value == null) return true; // optional
    if (!Array.isArray(value)) {
      this.message = 'conditions must be an array';
      return false;
    }
    for (let i = 0; i < value.length; i++) {
      const c = value[i] as any;
      if (c == null || typeof c !== 'object' || Array.isArray(c)) {
        this.message = `conditions[${i}] must be an object {field, op, value}`;
        return false;
      }
      if (!isNonEmptyString(c.field)) {
        this.message = `conditions[${i}].field must be a non-empty string`;
        return false;
      }
      if (!(CONDITION_OPS as readonly string[]).includes(c.op)) {
        this.message = `conditions[${i}].op must be one of ${CONDITION_OPS.join(', ')}`;
        return false;
      }
      if (!('value' in c)) {
        this.message = `conditions[${i}] must include a "value"`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return this.message;
  }
}
