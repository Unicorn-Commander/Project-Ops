import { TasksRecurrenceService } from './tasks-recurrence.service';

/**
 * Unit tests for the recurring-task materializer. `runInWorkspace` is stubbed to
 * invoke the callback with a fake tx, so the real method body runs without a DB.
 */

function makeService(opts: {
  templates?: any[];
  latestInstance?: (args: any) => Promise<any>;
  existingAtOccurrence?: (args: any) => Promise<any>;
  workspaces?: { id: string }[];
}) {
  const taskCreate = jest.fn(async (a: any) => ({ id: 'inst', ...a.data }));

  // findFirst is used twice with different where-shapes: latest instance
  // (orderBy dueDate desc) and the idempotency probe (where.dueDate set).
  const taskFindFirst = jest.fn(async (args: any) => {
    if (args.orderBy) {
      return opts.latestInstance ? opts.latestInstance(args) : null;
    }
    return opts.existingAtOccurrence ? opts.existingAtOccurrence(args) : null;
  });

  const tx = {
    task: {
      findMany: jest.fn(async () => opts.templates ?? []),
      findFirst: taskFindFirst,
      create: taskCreate,
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

  const svc = new TasksRecurrenceService(prisma as any, workspaceContext as any);
  return { svc, tx, taskCreate, prisma, workspaceContext };
}

const baseTemplate = {
  id: 'tmpl1',
  workspaceId: 'ws1',
  projectId: 'p1',
  title: 'Weekly report',
  description: 'do it',
  type: 'TASK',
  status: 'PENDING',
  priority: 'HIGH',
  assignedToId: 'u-assignee',
  estimatedHours: '2.50',
  createdById: 'u-creator',
  recurrenceRule: 'FREQ=WEEKLY;INTERVAL=1',
  recurrenceParentId: null,
  dueDate: new Date('2026-06-01T09:00:00.000Z'),
  metadata: { foo: 'bar' },
  createdAt: new Date('2026-05-01T00:00:00.000Z'),
};

describe('TasksRecurrenceService.materializeForWorkspace', () => {
  it('spawns the next instance and copies template content (rule nulled)', async () => {
    const { svc, taskCreate } = makeService({ templates: [baseTemplate] });
    // Anchor = template.dueDate Jun 1; next weekly = Jun 8. now = Jun 8 → due.
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-08T09:00:00.000Z'));

    expect(created).toBe(1);
    const data = taskCreate.mock.calls[0][0].data;
    expect(data.recurrenceParentId).toBe('tmpl1');
    expect(data.recurrenceRule).toBeNull();
    expect(data.dueDate.toISOString()).toBe('2026-06-08T09:00:00.000Z');
    expect(data.title).toBe('Weekly report');
    expect(data.projectId).toBe('p1');
    expect(data.priority).toBe('HIGH');
    expect(data.assignedToId).toBe('u-assignee');
    expect(data.estimatedHours).toBe('2.50');
    expect(data.createdById).toBe('u-creator');
    expect(data.workspaceId).toBe('ws1');
    expect(data.metadata).toEqual({ foo: 'bar' });
  });

  it('is idempotent: skips when an instance already exists at the occurrence', async () => {
    const { svc, taskCreate } = makeService({
      templates: [baseTemplate],
      existingAtOccurrence: async () => ({ id: 'already' }),
    });
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-08T09:00:00.000Z'));
    expect(created).toBe(0);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('anchors on the latest spawned instance, not the template dueDate', async () => {
    const { svc, taskCreate } = makeService({
      templates: [baseTemplate],
      latestInstance: async () => ({ dueDate: new Date('2026-06-08T09:00:00.000Z') }),
    });
    // Latest instance Jun 8 → next weekly Jun 15. now Jun 15 → due.
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-15T09:00:00.000Z'));
    expect(created).toBe(1);
    expect(taskCreate.mock.calls[0][0].data.dueDate.toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('does not spawn when the next occurrence is beyond the look-ahead horizon', async () => {
    const { svc, taskCreate } = makeService({ templates: [baseTemplate] });
    // Anchor Jun 1 → next Jun 8, but now is Jun 1 (a week away, > 1d horizon).
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-06-01T09:00:00.000Z'));
    expect(created).toBe(0);
    expect(taskCreate).not.toHaveBeenCalled();
  });

  it('skips templates whose rule is unparseable/unsupported', async () => {
    const { svc, taskCreate } = makeService({
      templates: [{ ...baseTemplate, recurrenceRule: 'FREQ=YEARLY' }],
    });
    const created = await svc.materializeForWorkspace('ws1', new Date('2026-12-31T00:00:00.000Z'));
    expect(created).toBe(0);
    expect(taskCreate).not.toHaveBeenCalled();
  });
});

describe('TasksRecurrenceService.materializeDueRecurrences (cron entry)', () => {
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
        fn({ task: { findMany: async () => [] } }),
      );
    // Should not throw despite wsA failing.
    await expect(
      svc.materializeDueRecurrences(new Date('2026-06-08T09:00:00.000Z')),
    ).resolves.toBeUndefined();
  });
});
