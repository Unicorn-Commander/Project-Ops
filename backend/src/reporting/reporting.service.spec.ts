import { ReportingService } from './reporting.service';
import { ProjectStatus, TaskStatus } from '@prisma/client';

/**
 * Unit tests for the reporting rollups. workspaceContext.runForUser invokes the
 * callback with a fake tx, so the real aggregation/fold logic runs without a DB.
 * Decimal money fields are passed as strings (how Prisma returns them).
 */

const admin = { id: 'a1', role: 'ADMIN' } as any;
const client = { id: 'c1', role: 'CLIENT' } as any;

function makeService(tx: any) {
  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };
  const svc = new ReportingService({} as any, workspaceContext as any);
  return { svc };
}

describe('ReportingService.getPortfolio', () => {
  it('rolls up logged vs budget hours, billed vs budget amount, % complete, over-budget + totals', async () => {
    const tx = {
      project: {
        findMany: jest.fn(async () => [
          {
            id: 'p1',
            projectNumber: 'PROJ-1',
            title: 'A',
            status: ProjectStatus.IN_PROGRESS,
            clientName: 'Acme',
            budgetHours: '10',
            budgetAmount: '1000',
          },
        ]),
      },
      timeEntry: {
        groupBy: jest.fn(async (args: any) => {
          // logged-seconds call has no `billable` filter; billed-amount call does.
          if (args.where.billable === true) {
            return [{ projectId: 'p1', _sum: { billableAmount: '1500.00' } }];
          }
          // 14.4h logged = 51840s
          return [
            {
              projectId: 'p1',
              _sum: { roundingAppliedSeconds: 51840, durationSeconds: 51840 },
            },
          ];
        }),
      },
      task: {
        groupBy: jest.fn(async () => [
          { projectId: 'p1', status: TaskStatus.COMPLETED, _count: { _all: 3 } },
          { projectId: 'p1', status: TaskStatus.PENDING, _count: { _all: 1 } },
        ]),
      },
    };
    const { svc } = makeService(tx);

    const out = await svc.getPortfolio('ws1', admin);
    const row = out.projects[0];

    expect(row.loggedHours).toBe(14.4);
    expect(row.pctHours).toBe(144); // 14.4/10
    expect(row.billedAmount).toBe(1500);
    expect(row.pctAmount).toBe(150); // 1500/1000
    expect(row.tasksTotal).toBe(4);
    expect(row.tasksCompleted).toBe(3);
    expect(row.percentComplete).toBe(75);
    expect(row.overBudget).toBe(true);

    expect(out.totals.projects).toBe(1);
    expect(out.totals.activeProjects).toBe(1);
    expect(out.totals.tasksTotal).toBe(4);
    expect(out.totals.tasksCompleted).toBe(3);
    expect(out.totals.loggedHours).toBe(14.4);
    expect(out.totals.billedAmount).toBe(1500);
    expect(out.totals.overBudgetCount).toBe(1);
    expect(out.statusBreakdown).toEqual([{ label: ProjectStatus.IN_PROGRESS, value: 1 }]);
  });

  it('returns empty totals when the workspace has no visible projects', async () => {
    const tx = { project: { findMany: jest.fn(async () => []) } };
    const { svc } = makeService(tx);

    const out = await svc.getPortfolio('ws1', admin);
    expect(out.projects).toEqual([]);
    expect(out.totals.projects).toBe(0);
  });
});

describe('ReportingService.getProfitability', () => {
  it('computes billable (stored amount), cost basis, margin, and realization', async () => {
    const tx = {
      timeEntry: {
        groupBy: jest.fn(async (args: any) => {
          if (args.where.billed === true) {
            // billed slice
            return [{ projectId: 'p1', _sum: { billableAmount: '500.00' } }];
          }
          // billable slice: $1000 over 10h (36000s)
          return [
            {
              projectId: 'p1',
              _sum: {
                billableAmount: '1000.00',
                roundingAppliedSeconds: 36000,
                durationSeconds: 36000,
              },
            },
          ];
        }),
        // cost entries: $40/h cost over 10h = $400 cost basis
        findMany: jest.fn(async () => [
          {
            projectId: 'p1',
            costRateApplied: '40',
            roundingAppliedSeconds: 36000,
            durationSeconds: 36000,
          },
        ]),
      },
      project: {
        findMany: jest.fn(async () => [
          { id: 'p1', projectNumber: 'PROJ-1', title: 'A', clientName: 'Acme' },
        ]),
      },
    };
    const { svc } = makeService(tx);

    const out = await svc.getProfitability('ws1', admin, {});
    const row = out.projects[0];

    expect(row.billableAmount).toBe(1000);
    expect(row.billedAmount).toBe(500);
    expect(row.costBasis).toBe(400);
    expect(row.margin).toBe(600); // 1000 - 400
    expect(row.marginPct).toBe(60);
    expect(row.realization).toBe(50); // 500/1000

    expect(out.totals.billableAmount).toBe(1000);
    expect(out.totals.costBasis).toBe(400);
    expect(out.totals.margin).toBe(600);
    expect(out.totals.realization).toBe(50);
  });

  it('omits cost/margin for non-privileged (CLIENT) viewers', async () => {
    const findMany = jest.fn(async () => []);
    const tx = {
      timeEntry: {
        groupBy: jest.fn(async (args: any) =>
          args.where.billed === true
            ? []
            : [
                {
                  projectId: 'p1',
                  _sum: {
                    billableAmount: '200.00',
                    roundingAppliedSeconds: 3600,
                    durationSeconds: 3600,
                  },
                },
              ],
        ),
        findMany,
      },
      project: {
        findMany: jest.fn(async () => [
          { id: 'p1', projectNumber: 'PROJ-1', title: 'A', clientName: 'Acme' },
        ]),
      },
    };
    const { svc } = makeService(tx);

    const out = await svc.getProfitability('ws1', client, {});
    expect(out.projects[0].costBasis).toBeNull();
    expect(out.projects[0].margin).toBeNull();
    expect(out.totals.costBasis).toBeNull();
    // Cost entries are never even queried for a CLIENT.
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('ReportingService.getThroughput', () => {
  it('buckets completed tasks/projects by ISO week and returns a task status breakdown', async () => {
    const tx = {
      task: {
        findMany: jest.fn(async () => [
          { completedAt: new Date('2026-01-05T00:00:00Z') }, // W02
          { completedAt: new Date('2026-01-06T00:00:00Z') }, // W02
          { completedAt: new Date('2026-01-13T00:00:00Z') }, // W03
        ]),
        groupBy: jest.fn(async () => [
          { status: TaskStatus.COMPLETED, _count: { _all: 3 } },
          { status: TaskStatus.PENDING, _count: { _all: 2 } },
        ]),
      },
      project: {
        findMany: jest.fn(async () => [{ completedAt: new Date('2026-01-05T00:00:00Z') }]),
      },
    };
    const { svc } = makeService(tx);

    const out = await svc.getThroughput('ws1', admin, {
      from: '2026-01-01',
      to: '2026-01-31',
    });

    expect(out.tasksCompleted.total).toBe(3);
    expect(out.tasksCompleted.series).toEqual([
      { label: '2026-W02', value: 2 },
      { label: '2026-W03', value: 1 },
    ]);
    expect(out.projectsCompleted.total).toBe(1);
    expect(out.tasksByStatus).toEqual([
      { label: TaskStatus.COMPLETED, value: 3 },
      { label: TaskStatus.PENDING, value: 2 },
    ]);
  });
});
