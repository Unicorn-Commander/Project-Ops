import {
  evaluateCondition,
  isValidCondition,
  matchesConditions,
  parseConditions,
  resolveField,
} from './automation-conditions';
import { AutomationCondition } from './automation.types';

const c = (field: string, op: string, value: unknown): AutomationCondition =>
  ({ field, op, value }) as AutomationCondition;

describe('resolveField', () => {
  it('reads top-level and nested dotted paths', () => {
    const ev = { priority: 'HIGH', task: { projectId: 'p1' } };
    expect(resolveField(ev, 'priority')).toBe('HIGH');
    expect(resolveField(ev, 'task.projectId')).toBe('p1');
  });

  it('returns undefined for missing paths', () => {
    expect(resolveField({ a: 1 }, 'b')).toBeUndefined();
    expect(resolveField({ a: 1 }, 'a.b.c')).toBeUndefined();
    expect(resolveField(null, 'x')).toBeUndefined();
  });
});

describe('evaluateCondition', () => {
  const ev = {
    priority: 'URGENT',
    toStatus: 'COMPLETED',
    count: 5,
    title: 'Fix the Login Bug',
    tags: ['backend', 'p0'],
  };

  it('eq matches exactly and case-insensitively for strings', () => {
    expect(evaluateCondition(ev, c('priority', 'eq', 'URGENT'))).toBe(true);
    expect(evaluateCondition(ev, c('priority', 'eq', 'urgent'))).toBe(true);
    expect(evaluateCondition(ev, c('priority', 'eq', 'LOW'))).toBe(false);
  });

  it('neq is the negation of eq', () => {
    expect(evaluateCondition(ev, c('toStatus', 'neq', 'PENDING'))).toBe(true);
    expect(evaluateCondition(ev, c('toStatus', 'neq', 'COMPLETED'))).toBe(false);
  });

  it('contains does substring (string) and membership (array)', () => {
    expect(evaluateCondition(ev, c('title', 'contains', 'login'))).toBe(true);
    expect(evaluateCondition(ev, c('title', 'contains', 'logout'))).toBe(false);
    expect(evaluateCondition(ev, c('tags', 'contains', 'p0'))).toBe(true);
    expect(evaluateCondition(ev, c('tags', 'contains', 'frontend'))).toBe(false);
  });

  it('gt / lt compare numerically (and coerce numeric strings)', () => {
    expect(evaluateCondition(ev, c('count', 'gt', 3))).toBe(true);
    expect(evaluateCondition(ev, c('count', 'gt', 10))).toBe(false);
    expect(evaluateCondition(ev, c('count', 'lt', 10))).toBe(true);
    expect(evaluateCondition({ count: '5' }, c('count', 'gt', '3'))).toBe(true);
  });

  it('gt / lt are false when not comparable', () => {
    expect(evaluateCondition(ev, c('priority', 'gt', 3))).toBe(false);
    expect(evaluateCondition(ev, c('missing', 'lt', 3))).toBe(false);
  });

  it('unknown op is false', () => {
    expect(evaluateCondition(ev, c('priority', 'weird' as any, 'URGENT'))).toBe(false);
  });
});

describe('matchesConditions (AND semantics)', () => {
  const ev = { priority: 'URGENT', toStatus: 'COMPLETED' };

  it('empty/absent conditions always match', () => {
    expect(matchesConditions(ev, [])).toBe(true);
  });

  it('all conditions must pass', () => {
    expect(
      matchesConditions(ev, [c('priority', 'eq', 'URGENT'), c('toStatus', 'eq', 'COMPLETED')]),
    ).toBe(true);
    expect(
      matchesConditions(ev, [c('priority', 'eq', 'URGENT'), c('toStatus', 'eq', 'PENDING')]),
    ).toBe(false);
  });
});

describe('parseConditions / isValidCondition', () => {
  it('keeps only structurally-valid conditions', () => {
    const raw = [
      { field: 'priority', op: 'eq', value: 'URGENT' }, // ok
      { field: 'x', op: 'bogus', value: 1 }, // bad op
      { field: '', op: 'eq', value: 1 }, // empty field
      { field: 'y', op: 'eq' }, // missing value
      'nope',
    ];
    const parsed = parseConditions(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].field).toBe('priority');
  });

  it('non-array / null -> empty', () => {
    expect(parseConditions(null)).toEqual([]);
    expect(parseConditions({})).toEqual([]);
  });

  it('isValidCondition guards the shape', () => {
    expect(isValidCondition({ field: 'a', op: 'eq', value: 1 })).toBe(true);
    expect(isValidCondition({ field: 'a', op: 'eq' })).toBe(false);
    expect(isValidCondition(null)).toBe(false);
  });
});
