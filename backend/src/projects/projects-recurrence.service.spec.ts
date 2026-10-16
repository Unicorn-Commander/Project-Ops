import { ProjectsRecurrenceService } from './projects-recurrence.service';
import { BUSINESS_TIME_ZONE } from '../common/time/business-time';

/**
 * Unit tests for the recurring-project materializer. Mirrors
 * tasks-recurrence.service.spec.ts: runInWorkspace is stubbed to invoke the
 * callback with a fake tx, so the real method body runs without a DB.
 */

function makeService(opts: {
  templates?: any[];
  latestInstance?: (args: any) => Promise<any>;
  existingAtOccurrence?: (args: any) => Promise<any>;
  workspaces?: { id: string }[];
}) {
  const projectCreate = jest.fn(async (a: any) => ({ id: 'inst', ...a.data }));

  // findFirst is used twice with different where-shapes: latest instance
  // (orderBy dueDate desc) and the idempotency probe (where.dueDate set).
  const projectFindFirst = jest.fn(async (args: any) => {
    if (args.orderBy) {
      return opts.latestInstance ? opts.latestInstance(args) : null;
    }
    return opts.existingAtOccurrence ? opts.existingAtOccurrence(args) : null;
  });

  const tx = {
    project: {
      findMany: jest.fn(async () => opts.templates ?? []),
      findFirst: projectFindFirst,
      create: projectCreate,
    },
  };

  const prisma = {
    workspace: {
      findMany: jest.fn(async () => opts.workspaces ?? [{ id: 'ws1' }]),
    },
  };

  const workspaceContext = {
    runInWorkspace: jest.fn(async (_ws: string, _uid: any, fn: (t: any) => any) => fn(tx)),
  };

  // ProjectsService dependency — only nextProjectNumber is exercised here.
  const projects = {
    nextProjectNumber: jest.fn(async () => 'PROJ-2026-000042'),
  };

  const svc = new ProjectsRecurrenceService(
    prisma as any,
    workspaceContext as any,
    projects as any,
  );
  return { svc, tx, projectCreate, prisma, workspaceContext, projects };
}

const baseTemplate = {
  id: 'tmpl1',
  workspaceId: 'ws1',
  projectNumber: 'PROJ-TMPL',
  title: 'Monthly retainer',
  description: 'do it',
  status: 'IN_PROGRESS',
  priority: 'HIGH',
  category: 'Retainer',
  tags: ['a'],
  clientName: 'Acme',
  clientEmail: 'ap@acme.test',
  clientPhone: null,
  contactId: 'c1',
  organizationId: 'org1',
  assignedToId: 'u-assignee',
  createdById: 'u-creator',
  billByDefault: true,
  defaultBillRate: '150.0000',
  budgetHours: '20.00',
  budgetAmount: '3000.00',
  roundingIncrementMinutes: 15,
  roundingMode: 'NEAREST',
  metadata: { foo: 'bar' },
  recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
  recurrenceParentId: null,
  dueDate: new Date('2026-06-01T09:00:00.000Z'),
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('ProjectsRecurrenceService.materializeForWorkspace', () => {
  it('spawns the next instance, copies template content, nulls the rule, fresh number', async () => {
    const { svc, projectCreate, projects } = makeService({ templates: [baseTemplate] });
    // Anchor = template.dueDate Jun 1; next weekly = Jun 8. now = Jun 8 → due.
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-08T09:00:00.000Z'));

    expect(created).toBe(1);
    expect(projects.nextProjectNumber).toHaveBeenCalled();
    const data = projectCreate.mock.calls[0][0].data;
    expect(data.recurrenceParentId).toBe('tmpl1');
    expect(data.recurrenceRule).toBeNull();
    expect(data.status).toBeUndefined(); // defaults to NEW
    expect(data.projectNumber).toBe('PROJ-2026-000042');
    expect(data.dueDate.toISOString()).toBe('2026-06-08T09:00:00.000Z');
    expect(data.title).toBe('Monthly retainer');
    expect(data.clientName).toBe('Acme');
    expect(data.budgetAmount).toBe('3000.00');
    expect(data.assignedToId).toBe('u-assignee');
    expect(data.createdById).toBe('u-creator');
    expect(data.workspaceId).toBe('ws1');
    expect(data.metadata).toEqual({ foo: 'bar' });
  });

  it('is idempotent: skips when an instance already exists at the occurrence', async () => {
    const { svc, projectCreate } = makeService({
      templates: [baseTemplate],
      existingAtOccurrence: async () => ({ id: 'already' }),
    });
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-08T09:00:00.000Z'));
    expect(created).toBe(0);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it('anchors on the latest spawned instance, not the template dueDate', async () => {
    const { svc, projectCreate } = makeService({
      templates: [baseTemplate],
      latestInstance: async () => ({ dueDate: new Date('2026-06-08T09:00:00.000Z') }),
    });
    // Latest instance Jun 8 → next weekly Jun 15. now Jun 15 → due.
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-15T09:00:00.000Z'));
    expect(created).toBe(1);
    expect(projectCreate.mock.calls[0][0].data.dueDate.toISOString()).toBe(
      '2026-06-15T09:00:00.000Z',
    );
  });

  it('does not spawn when the next occurrence is beyond the look-ahead horizon', async () => {
    const { svc, projectCreate } = makeService({ templates: [baseTemplate] });
    // Anchor Jun 1 → next Jun 8, but now is Jun 1 (a week away, > 1d horizon).
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-01T09:00:00.000Z'));
    expect(created).toBe(0);
    expect(projectCreate).not.toHaveBeenCalled();
  });

  it('skips templates whose rule is unparseable/unsupported', async () => {
    const { svc, projectCreate } = makeService({
      templates: [{ ...baseTemplate, recurrenceRule: 'FREQ=YEARLY' }],
    });
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-12-31T00:00:00.000Z'));
    expect(created).toBe(0);
    expect(projectCreate).not.toHaveBeenCalled();
  });
});

describe('ProjectsRecurrenceService.materializeDueRecurrences (cron entry)', () => {
  it('declares the business timezone on the cron decorator', () => {
    const metadata = Reflect.getMetadata(
      'SCHEDULE_CRON_OPTIONS',
      ProjectsRecurrenceService.prototype.materializeDueRecurrences,
    );

    expect(metadata).toEqual(expect.objectContaining({ timeZone: BUSINESS_TIME_ZONE }));
  });

  it('iterates active workspaces via the control-plane read', async () => {
    const { svc, prisma, workspaceContext } = makeService({
      workspaces: [{ id: 'wsA' }, { id: 'wsB' }],
      templates: [],
    });
    await svc.materializeDueRecurrences(new Date('2026-06-08T09:00:00.000Z'));
    expect(prisma.workspace.findMany).toHaveBeenCalledWith({
      where: { status: 'active' },
      select: { id: true },
    });
    expect(workspaceContext.runInWorkspace).toHaveBeenCalledTimes(2);
  });

  it('isolates a failing workspace and continues', async () => {
    const { svc, workspaceContext } = makeService({
      workspaces: [{ id: 'wsA' }, { id: 'wsB' }],
      templates: [],
    });
    (workspaceContext.runInWorkspace as jest.Mock)
      .mockRejectedValueOnce(new Error('boom'))
      .mockImplementationOnce(async (_ws: string, _uid: any, fn: (t: any) => any) =>
        fn({ project: { findMany: async () => [] } }),
      );
    await expect(
      svc.materializeDueRecurrences(new Date('2026-06-08T09:00:00.000Z')),
    ).resolves.toBeUndefined();
  });
});
