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
