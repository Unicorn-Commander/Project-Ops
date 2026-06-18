import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import {
  CapacityService,
  CapacityWindow,
  DEFAULT_WEEKLY_CAPACITY_HOURS,
  WorkspaceMemberIdentity,
} from './capacity.service';

/**
 * Unit tests for the capacity planner. The pure statics (window math,
 * pro-ration, row/total assembly) are exercised directly. The DB-touching
 * methods are exercised with hand-rolled mocks where `workspaceContext.runForUser`
 * simply invokes the callback with a fake tx (the suite spec style — see
 * tasks.service.spec.ts), so we run the real method bodies without a DB.
 */

const user = { id: 'u1', email: 'a@x.co', role: 'MANAGER' } as any;

/** A Prisma-Decimal-like stand-in: groupBy._sum returns objects with .toString(). */
function dec(n: number) {
  return { toString: () => String(n) } as any;
}

/**
 * Build a CapacityService whose fake tx + prisma are backed by the supplied
 * stubs. `committedRows`/`unestimatedRows` are what the two task.groupBy passes
 * return; `memberships`/`users` back the control-plane reads.
 */
function makeService(opts: {
  committedRows?: any[];
  unestimatedRows?: any[];
  memberships?: any[];
  users?: any[];
  userUpdate?: (args: any) => Promise<any>;
}) {
  const tx = {
    task: {
      groupBy: jest
        .fn()
        // call order in aggregateWorkload: [committed, unestimated]
        .mockResolvedValueOnce(opts.committedRows ?? [])
        .mockResolvedValueOnce(opts.unestimatedRows ?? []),
    },
  };

  const prisma = {
    membership: {
      findMany: jest.fn(async () => opts.memberships ?? []),
    },
    user: {
      findMany: jest.fn(async () => opts.users ?? []),
      update: jest.fn(
        opts.userUpdate ??
          (async (a: any) => ({
            id: a.where.id,
            email: 'x@y.z',
            firstName: 'X',
            lastName: 'Y',
            weeklyCapacityHours: a.data.weeklyCapacityHours,
          })),
      ),
    },
  };

  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };

  const svc = new CapacityService(prisma as any, workspaceContext as any);
  return { svc, tx, prisma, workspaceContext };
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe('CapacityService.currentWeek', () => {
  it('returns Monday 00:00 → Sunday 23:59:59.999 for a mid-week date', () => {
    // 2026-06-17 is a Wednesday.
    const wed = new Date(2026, 5, 17, 14, 30, 0);
    const { from, to } = CapacityService.currentWeek(wed);
    expect(from.getFullYear()).toBe(2026);
    expect(from.getMonth()).toBe(5);
    expect(from.getDate()).toBe(15); // Monday
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);
    expect(to.getDate()).toBe(21); // Sunday
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
    expect(CapacityService.windowDays({ from, to })).toBe(7);
  });

  it('treats Sunday as the LAST day of the week (not the first)', () => {
    const sun = new Date(2026, 5, 21, 9, 0, 0); // Sunday
    const { from, to } = CapacityService.currentWeek(sun);
    expect(from.getDate()).toBe(15); // still the prior Monday
    expect(to.getDate()).toBe(21);
  });
});

describe('CapacityService.windowDays', () => {
  it('is inclusive: a same-day window is 1 day', () => {
    const d: CapacityWindow = {
      from: new Date(2026, 5, 17, 0, 0, 0),
      to: new Date(2026, 5, 17, 23, 59, 59),
    };
    expect(CapacityService.windowDays(d)).toBe(1);
  });

  it('counts a two-week window as 14 days', () => {
    const d: CapacityWindow = {
      from: new Date(2026, 5, 1, 0, 0, 0),
      to: new Date(2026, 5, 14, 23, 59, 59),
    };
    expect(CapacityService.windowDays(d)).toBe(14);
  });
});

describe('CapacityService.proratedCapacity', () => {
  it('a full week of a 40h budget is 40h', () => {
    expect(CapacityService.proratedCapacity(40, 7)).toBe(40);
  });

  it('pro-rates a 40h weekly budget across a 14-day window to 80h', () => {
    expect(CapacityService.proratedCapacity(40, 14)).toBe(80);
  });

  it('pro-rates across a partial (3-day) window', () => {
    // 40 * 3/7 = 17.142857 -> 17.14
    expect(CapacityService.proratedCapacity(40, 3)).toBe(17.14);
  });

  it('falls back to the schema default (40h) when the budget is null', () => {
    expect(CapacityService.proratedCapacity(null, 7)).toBe(DEFAULT_WEEKLY_CAPACITY_HOURS);
    expect(CapacityService.proratedCapacity(undefined, 7)).toBe(40);
  });

  it('honors a 0h budget (user on leave) without falling back', () => {
    expect(CapacityService.proratedCapacity(0, 7)).toBe(0);
  });
});

describe('CapacityService.buildRow', () => {
  const member: WorkspaceMemberIdentity = {
    userId: 'u1',
    name: 'Ada Lovelace',
    weeklyCapacityHours: 40,
  };

  it('computes utilization and is NOT over-allocated when committed < capacity', () => {
    const row = CapacityService.buildRow(
      member,
      { committedHours: 30, taskCount: 5, unestimatedCount: 1 },
      7,
    );
    expect(row.capacityHours).toBe(40);
    expect(row.committedHours).toBe(30);
    expect(row.utilizationPct).toBe(75); // 30/40
    expect(row.overAllocated).toBe(false);
    expect(row.taskCount).toBe(5);
    expect(row.unestimatedCount).toBe(1);
  });

  it('flags over-allocation when committed strictly exceeds capacity', () => {
    const row = CapacityService.buildRow(
      member,
      { committedHours: 52, taskCount: 8, unestimatedCount: 0 },
      7,
    );
    expect(row.utilizationPct).toBe(130); // 52/40
    expect(row.overAllocated).toBe(true);
  });

  it('is exactly at capacity (100%) without being over-allocated', () => {
    const row = CapacityService.buildRow(
      member,
      { committedHours: 40, taskCount: 4, unestimatedCount: 0 },
      7,
    );
    expect(row.utilizationPct).toBe(100);
    expect(row.overAllocated).toBe(false);
  });

  it('zero-fills a member with no workload (free capacity)', () => {
    const row = CapacityService.buildRow(member, undefined, 7);
    expect(row.committedHours).toBe(0);
    expect(row.taskCount).toBe(0);
    expect(row.unestimatedCount).toBe(0);
    expect(row.utilizationPct).toBe(0);
    expect(row.overAllocated).toBe(false);
  });

  it('avoids divide-by-zero: a 0h-capacity user reports 0% utilization', () => {
    const zeroCap: WorkspaceMemberIdentity = { ...member, weeklyCapacityHours: 0 };
    const row = CapacityService.buildRow(
      zeroCap,
      { committedHours: 5, taskCount: 1, unestimatedCount: 0 },
      7,
    );
    expect(row.capacityHours).toBe(0);
    expect(row.utilizationPct).toBe(0);
    // committed (5) > capacity (0) -> still flagged so the impossible load is visible
    expect(row.overAllocated).toBe(true);
  });
});

describe('CapacityService.buildTotals', () => {
  it('rolls per-user rows into workspace totals', () => {
    const rows = [
      CapacityService.buildRow(
        { userId: 'a', name: 'A', weeklyCapacityHours: 40 },
        { committedHours: 50, taskCount: 5, unestimatedCount: 2 },
        7,
      ),
      CapacityService.buildRow(
        { userId: 'b', name: 'B', weeklyCapacityHours: 40 },
        { committedHours: 10, taskCount: 2, unestimatedCount: 0 },
        7,
      ),
    ];
    const totals = CapacityService.buildTotals(rows);
    expect(totals.capacityHours).toBe(80);
    expect(totals.committedHours).toBe(60);
    expect(totals.utilizationPct).toBe(75); // 60/80
    expect(totals.overAllocatedCount).toBe(1); // only A
    expect(totals.taskCount).toBe(7);
    expect(totals.unestimatedCount).toBe(2);
  });
});

describe('CapacityService.resolveWindow', () => {
  it('uses explicit from/to verbatim', () => {
    const svc = makeService({}).svc;
    const w = svc.resolveWindow('2026-06-01T00:00:00Z', '2026-06-07T23:59:59Z');
    expect(w.from.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-06-07T23:59:59.000Z');
  });

  it('rejects an inverted window (from after to)', () => {
    const svc = makeService({}).svc;
    expect(() => svc.resolveWindow('2026-06-10T00:00:00Z', '2026-06-01T00:00:00Z')).toThrow(
      BadRequestException,
    );
  });

  it('defaults to the current week when from/to omitted', () => {
    const svc = makeService({}).svc;
    const now = new Date(2026, 5, 17, 12, 0, 0); // Wednesday
    const w = svc.resolveWindow(undefined, undefined, now);
    expect(w.from.getDate()).toBe(15);
    expect(w.to.getDate()).toBe(21);
  });
});

// ─── aggregateWorkload (DB-shaped, mocked tx) ────────────────────────────────

describe('CapacityService.aggregateWorkload', () => {
  it('sums estimatedHours per assignee and folds in the unestimated count', async () => {
    const { svc, tx } = makeService({
      committedRows: [
        { assignedToId: 'u1', _sum: { estimatedHours: dec(12.5) }, _count: { _all: 4 } },
        { assignedToId: 'u2', _sum: { estimatedHours: dec(3) }, _count: { _all: 2 } },
      ],
      unestimatedRows: [{ assignedToId: 'u1', _count: { _all: 1 } }],
    });

    const window = {
      from: new Date(2026, 5, 15),
      to: new Date(2026, 5, 21, 23, 59, 59),
    };
    const map = await svc.aggregateWorkload(tx as any, window, ['u1', 'u2']);

    expect(map.get('u1')).toEqual({ committedHours: 12.5, taskCount: 4, unestimatedCount: 1 });
    // u2 has no unestimated row -> count is 0, not undefined
    expect(map.get('u2')).toEqual({ committedHours: 3, taskCount: 2, unestimatedCount: 0 });
  });

  it('treats a null _sum (all tasks unestimated) as 0 committed hours', async () => {
    const { svc, tx } = makeService({
      committedRows: [{ assignedToId: 'u1', _sum: { estimatedHours: null }, _count: { _all: 3 } }],
      unestimatedRows: [{ assignedToId: 'u1', _count: { _all: 3 } }],
    });
    const window = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 7) };
    const map = await svc.aggregateWorkload(tx as any, window, ['u1']);
    expect(map.get('u1')).toEqual({ committedHours: 0, taskCount: 3, unestimatedCount: 3 });
  });

  it('filters by window, assignee set, and excludes COMPLETED/CANCELLED', async () => {
    const { svc, tx } = makeService({ committedRows: [], unestimatedRows: [] });
    const window = { from: new Date(2026, 5, 1), to: new Date(2026, 5, 7, 23, 59, 59) };
    await svc.aggregateWorkload(tx as any, window, ['u1', 'u2']);

    const firstCallWhere = (tx.task.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(firstCallWhere.assignedToId).toEqual({ in: ['u1', 'u2'] });
    expect(firstCallWhere.status).toEqual({
      notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
    });
    expect(firstCallWhere.dueDate).toEqual({ gte: window.from, lte: window.to });

    // second pass adds estimatedHours: null
    const secondCallWhere = (tx.task.groupBy as jest.Mock).mock.calls[1][0].where;
    expect(secondCallWhere.estimatedHours).toBeNull();
  });

  it('short-circuits to an empty map when there are no members', async () => {
    const { svc, tx } = makeService({});
    const map = await svc.aggregateWorkload(tx as any, { from: new Date(), to: new Date() }, []);
    expect(map.size).toBe(0);
    expect(tx.task.groupBy).not.toHaveBeenCalled();
  });
});

// ─── listActiveMembers (control-plane, mocked prisma) ────────────────────────

describe('CapacityService.listActiveMembers', () => {
  it('resolves SSO (keycloakId) + local (id) members, skips invites + inactive', async () => {
    const { svc } = makeService({
      memberships: [
        { userKey: 'kc-1', status: 'ACTIVE', createdAt: new Date(1) },
        { userKey: 'local-2', status: 'ACTIVE', createdAt: new Date(2) },
        { userKey: 'invite:abc', status: 'ACTIVE', createdAt: new Date(3) },
      ],
      users: [
        {
          id: 'u1',
          keycloakId: 'kc-1',
          email: 'a@x.co',
          firstName: 'Ada',
          lastName: 'L',
          weeklyCapacityHours: 40,
        },
        {
          id: 'local-2',
          keycloakId: null,
          email: 'b@x.co',
          firstName: '',
          lastName: '',
          weeklyCapacityHours: null,
        },
      ],
    });

    const members = await svc.listActiveMembers('ws1');
    expect(members).toHaveLength(2);
    expect(members[0]).toEqual({ userId: 'u1', name: 'Ada L', weeklyCapacityHours: 40 });
    // empty names fall back to email; null capacity is preserved (defaulted later)
    expect(members[1]).toEqual({ userId: 'local-2', name: 'b@x.co', weeklyCapacityHours: null });
  });

  it('returns [] when the only memberships are pending invites', async () => {
    const { svc, prisma } = makeService({
      memberships: [{ userKey: 'invite:x', status: 'ACTIVE', createdAt: new Date() }],
    });
    const members = await svc.listActiveMembers('ws1');
    expect(members).toEqual([]);
    // no real keys -> no user lookup
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});

// ─── getMyCapacity / setUserCapacity (membership-gated) ──────────────────────

describe('CapacityService.getMyCapacity', () => {
  it('403s when the caller is not an active member', async () => {
    const { svc } = makeService({ memberships: [], users: [] });
    await expect(svc.getMyCapacity('ws1', user)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns a single-row report for the caller', async () => {
    const { svc } = makeService({
      memberships: [{ userKey: 'u1', status: 'ACTIVE', createdAt: new Date() }],
      users: [
        {
          id: 'u1',
          keycloakId: null,
          email: 'a@x.co',
          firstName: 'Ada',
          lastName: 'L',
          weeklyCapacityHours: 40,
        },
      ],
      committedRows: [
        { assignedToId: 'u1', _sum: { estimatedHours: dec(20) }, _count: { _all: 3 } },
      ],
      unestimatedRows: [],
    });
    const report = await svc.getMyCapacity('ws1', user);
    expect(report.users).toHaveLength(1);
    expect(report.users[0].userId).toBe('u1');
    expect(report.users[0].committedHours).toBe(20);
    expect(report.users[0].utilizationPct).toBe(50); // 20/40
    expect(report.totals.committedHours).toBe(20);
  });
});

describe('CapacityService.setUserCapacity', () => {
  it('404s when the target is not a member of the workspace', async () => {
    const { svc } = makeService({ memberships: [], users: [] });
    await expect(svc.setUserCapacity('ws1', 'stranger', 30)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates the weekly capacity for an active member', async () => {
    const { svc, prisma } = makeService({
      memberships: [{ userKey: 'u1', status: 'ACTIVE', createdAt: new Date() }],
      users: [
        {
          id: 'u1',
          keycloakId: null,
          email: 'a@x.co',
          firstName: 'Ada',
          lastName: 'L',
          weeklyCapacityHours: 40,
        },
      ],
      userUpdate: async (a: any) => ({
        id: 'u1',
        email: 'a@x.co',
        firstName: 'Ada',
        lastName: 'L',
        weeklyCapacityHours: a.data.weeklyCapacityHours,
      }),
    });
    const res = await svc.setUserCapacity('ws1', 'u1', 24);
    expect(res).toEqual({ userId: 'u1', name: 'Ada L', weeklyCapacityHours: 24 });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { weeklyCapacityHours: 24 } }),
    );
  });
});
