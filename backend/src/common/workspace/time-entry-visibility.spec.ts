import { UserRole } from '@prisma/client';
import {
  buildTimeEntryVisibilityFilter,
  redactCost,
  redactCostMany,
} from './time-entry-visibility';

const user = (role: UserRole) => ({ id: 'u1', role });

describe('buildTimeEntryVisibilityFilter', () => {
  it('ADMIN and MANAGER see the whole workspace', () => {
    expect(buildTimeEntryVisibilityFilter(user(UserRole.ADMIN), 'ws')).toEqual({
      workspaceId: 'ws',
    });
    expect(buildTimeEntryVisibilityFilter(user(UserRole.MANAGER), 'ws')).toEqual({
      workspaceId: 'ws',
    });
  });

  it('STAFF see their own entries or entries on their projects', () => {
    const f = buildTimeEntryVisibilityFilter(user(UserRole.STAFF), 'ws');
    expect(f.workspaceId).toBe('ws');
    expect(f.OR).toEqual([
      { userId: 'u1' },
      { project: { OR: [{ assignedToId: 'u1' }, { createdById: 'u1' }] } },
    ]);
  });

  it('CLIENT only see entries on projects they are the contact for', () => {
    const f = buildTimeEntryVisibilityFilter(user(UserRole.CLIENT), 'ws');
    expect(f.workspaceId).toBe('ws');
    expect(f.project).toEqual({ OR: [{ contactId: 'u1' }, { contact: { userId: 'u1' } }] });
  });
});

describe('cost redaction', () => {
  const entry = { id: 'e1', billableAmount: 100, costRateApplied: 65, billRateApplied: 150 };

  it('strips costRateApplied for CLIENT', () => {
    const out = redactCost({ ...entry }, UserRole.CLIENT);
    expect(out).not.toHaveProperty('costRateApplied');
    expect(out.billableAmount).toBe(100);
    expect(out.billRateApplied).toBe(150);
  });

  it('leaves cost intact for non-CLIENT roles', () => {
    expect(redactCost({ ...entry }, UserRole.ADMIN).costRateApplied).toBe(65);
    expect(redactCost({ ...entry }, UserRole.STAFF).costRateApplied).toBe(65);
  });

  it('redactCostMany applies per element only for CLIENT', () => {
    const many = redactCostMany([{ ...entry }, { ...entry }], UserRole.CLIENT);
    expect(many.every((e) => !('costRateApplied' in e))).toBe(true);
    const kept = redactCostMany([{ ...entry }], UserRole.MANAGER);
    expect(kept[0].costRateApplied).toBe(65);
  });
});
