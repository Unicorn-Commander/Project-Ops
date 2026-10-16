import { UserRole } from '@prisma/client';
import { DashboardService } from './dashboard.service';

/**
 * Unit tests for DashboardService.getProjectBreakdown (audit fix).
 *
 * Replaces the frontend `?limit=1000` fetch-then-bucket pattern with a DB-side
 * `groupBy`. These tests assert the response shape ({ byStatus, byPriority }),
 * that the counts come from groupBy (not a row fetch), and that role narrowing
 * is applied (CLIENT only sees own-created projects).
 */

function makeService(groupByImpl: (args: any) => Promise<any[]>) {
  const groupBy = jest.fn(async (args: any) => groupByImpl(args));
  const tx = { project: { groupBy } };

  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };

  const svc = new DashboardService({} as any, workspaceContext as any);
  return { svc, groupBy };
}

const admin = { id: 'u1', role: UserRole.ADMIN, email: 'a@x.co' } as any;
const client = { id: 'c1', role: UserRole.CLIENT, email: 'c@x.co' } as any;

describe('DashboardService.getProjectBreakdown', () => {
  it('returns counts grouped by status and priority', async () => {
    const { svc, groupBy } = makeService(async (args) => {
      if (args.by[0] === 'status') {
        return [
          { status: 'NEW', _count: 3 },
          { status: 'COMPLETED', _count: 7 },
        ];
      }
      return [{ priority: 'HIGH', _count: 5 }];
    });

    const out = await svc.getProjectBreakdown('ws1', admin);

    expect(out).toEqual({
      byStatus: [
        { status: 'NEW', count: 3 },
        { status: 'COMPLETED', count: 7 },
      ],
      byPriority: [{ priority: 'HIGH', count: 5 }],
    });
    // counts come from groupBy (no findMany row pull), once per dimension
    expect(groupBy).toHaveBeenCalledTimes(2);
  });

  it('narrows by role for a CLIENT (own-created projects only)', async () => {
    const { svc, groupBy } = makeService(async () => []);

    await svc.getProjectBreakdown('ws1', client);

    // both groupBy calls carry the CLIENT role filter
    for (const call of groupBy.mock.calls) {
      expect(call[0].where).toEqual({ createdById: 'c1' });
    }
  });

  it('applies no role filter for ADMIN', async () => {
    const { svc, groupBy } = makeService(async () => []);

    await svc.getProjectBreakdown('ws1', admin);

    for (const call of groupBy.mock.calls) {
      expect(call[0].where).toEqual({});
    }
  });
});

describe('DashboardService — CLIENT-role masking on full-row project summaries', () => {
  const projectRow = () => ({
    id: 'p1',
    projectNumber: 'PROJ-1',
    title: 'Order Pad',
    metadata: {
      quote: {
        customer_ops_quote_id: 'q-1',
        number: 'Q-2026-0001',
        version: 1,
        share_url: 'https://customers.example.dev/q/tok',
        schedule_ids: ['sched-1'],
      },
    },
    defaultBillRate: '150.0000',
    budgetAmount: '4300.00',
    budgetHours: '40',
    billingNotes: 'Quote Q-2026-0001 v1',
  });

  function makeListService(findManyImpl: (args: any) => Promise<any[]>) {
    const findMany = jest.fn(async (args: any) => findManyImpl(args));
    const tx = { project: { findMany } };
    const workspaceContext = {
      runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
    };
    const svc = new DashboardService({} as any, workspaceContext as any);
    return { svc, findMany };
  }

  it('getRecentProjects strips commercial columns + quote ids for a CLIENT', async () => {
    const { svc, findMany } = makeListService(async () => [projectRow()]);
    const out: any = await svc.getRecentProjects({ project: { findMany } } as any, 10, client);
    const p = out[0];
    expect(p).not.toHaveProperty('defaultBillRate');
    expect(p).not.toHaveProperty('budgetAmount');
    expect(p).not.toHaveProperty('budgetHours');
    expect(p).not.toHaveProperty('billingNotes');
    expect(JSON.stringify(p)).not.toContain('customer_ops_quote_id');
    expect(JSON.stringify(p)).not.toContain('sched-1');
  });

  it('getRecentProjects leaves full rows for an ADMIN', async () => {
    const { svc, findMany } = makeListService(async () => [projectRow()]);
    const out: any = await svc.getRecentProjects({ project: { findMany } } as any, 10, admin);
    expect(out[0].defaultBillRate).toBe('150.0000');
    expect(out[0].metadata.quote.customer_ops_quote_id).toBe('q-1');
  });

  it('getUpcomingDueDates strips commercial columns + quote ids for a CLIENT', async () => {
    const { svc } = makeListService(async () => [projectRow()]);
    const out: any = await svc.getUpcomingDueDates('ws1', 7, client);
    const p = out[0];
    expect(p).not.toHaveProperty('defaultBillRate');
    expect(p).not.toHaveProperty('budgetAmount');
    expect(p).not.toHaveProperty('billingNotes');
    expect(JSON.stringify(p)).not.toContain('customer_ops_quote_id');
  });
});

describe('DashboardService.getMonthlyStats — business-month boundaries', () => {
  it('uses New York midnight through the next New York month start', async () => {
    const count = jest.fn(async (..._args: any[]) => 0);
    const tx = {
      project: { count },
      document: { count },
      comment: { count },
    };
    const workspaceContext = {
      runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
    };
    const service = new DashboardService({} as any, workspaceContext as any);

    await service.getMonthlyStats('ws1', admin, 2026, 10);

    for (const call of count.mock.calls) {
      const args: any = call[0];
      const field = Object.keys(args.where)[0];
      expect(args.where[field]).toEqual({
        gte: new Date('2026-10-01T04:00:00.000Z'),
        lt: new Date('2026-11-01T04:00:00.000Z'),
      });
    }
  });
});
