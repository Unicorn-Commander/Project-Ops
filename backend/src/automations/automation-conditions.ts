import { AutomationCondition, CONDITION_OPS, ConditionOp } from './automation.types';

/**
 * Pure condition evaluation for the rules engine. No NestJS / DB deps so it is
 * trivially unit-testable and reused by both the engine and tests.
 */

/** Is `value` a structurally-valid {field, op, value}? */
export function isValidCondition(value: unknown): value is AutomationCondition {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.field === 'string' &&
    c.field.length > 0 &&
    typeof c.op === 'string' &&
    (CONDITION_OPS as readonly string[]).includes(c.op) &&
    'value' in c
  );
}

/** Parse a stored `conditions` Json blob into the valid subset (or [] / throw-free). */
export function parseConditions(raw: unknown): AutomationCondition[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidCondition);
}

/**
 * Resolve a dotted `field` path against the event payload. Supports nested
 * access (`task.projectId`) so a rule can read either a top-level event field
 * (`toStatus`, `priority`) or a field on the embedded entity (`task.priority`).
 * Returns undefined for a missing path.
 */
export function resolveField(event: unknown, field: string): unknown {
  if (event == null) return undefined;
  let cur: unknown = event;
  for (const part of field.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Coerce to a finite number for gt/lt; NaN when not comparable. */
function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '') return Number(v);
  if (v instanceof Date) return v.getTime();
  return NaN;
}

/** Evaluate ONE condition against the event. Unknown ops / bad paths => false. */
export function evaluateCondition(event: unknown, cond: AutomationCondition): boolean {
  const actual = resolveField(event, cond.field);
  const expected = cond.value;

  switch (cond.op as ConditionOp) {
    case 'eq':
      // Compare as strings when one side is an enum-like string, else strict.
      return looseEquals(actual, expected);
    case 'neq':
      return !looseEquals(actual, expected);
    case 'contains': {
      // Substring (string actual) OR membership (array actual).
      if (Array.isArray(actual)) return actual.some((x) => looseEquals(x, expected));
      if (actual == null) return false;
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    }
    case 'gt': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      return !Number.isNaN(a) && !Number.isNaN(b) && a > b;
    }
    case 'lt': {
      const a = toNumber(actual);
      const b = toNumber(expected);
      return !Number.isNaN(a) && !Number.isNaN(b) && a < b;
    }
    default:
      return false;
  }
}

/**
 * Strict-ish equality that treats enum strings / numbers / booleans sanely:
 * exact match first, then a string-normalized compare so `priority === "HIGH"`
 * works regardless of casing differences between rule config and payload.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' || typeof b === 'object') return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Does the event satisfy ALL conditions (logical AND)? An empty conditions list
 * means "always fire". Defensive: any individual condition that throws is
 * treated as a non-match (never bubbles out of the engine).
 */
export function matchesConditions(event: unknown, conditions: AutomationCondition[]): boolean {
  if (!conditions || conditions.length === 0) return true;
  for (const cond of conditions) {
    try {
      if (!evaluateCondition(event, cond)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
