import {
  ProjectsService,
  PROJECT_CREATED_EVENT,
  PROJECT_STATUS_CHANGED_EVENT,
} from './projects.service';
import { ProjectStatus } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

/**
 * Unit tests for the Wave 2 project features on ProjectsService: custom-field
 * merge into metadata, and the project.created / project.status_changed domain
 * events. (Recurrence materialization lives in ProjectsRecurrenceService and is
 * covered by projects-recurrence.service.spec.ts.)
 *
 * Mirrors the suite test style (tasks.service.spec.ts): hand-rolled mocks where
 * workspaceContext.runForUser invokes the callback with a fake tx, so we
 * exercise the real method bodies without a DB.
 */

const user = { id: 'u1', email: 'a@x.co', role: 'ADMIN' } as any;

function makeService(
  opts: {
    tx?: any;
    validateValues?: (...args: any[]) => Promise<any>;
  } = {},
) {
  const tx = opts.tx ?? {};
  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };
  const emit = jest.fn();
  const auditService = { log: jest.fn(async () => undefined) };
  const customFields = opts.validateValues
    ? { validateValues: jest.fn(opts.validateValues) }
    : undefined;

  const svc = new ProjectsService(
    {} as any, // prisma
    auditService as any,
    workspaceContext as any,
    { emit } as any, // eventEmitter
    customFields as any, // optional CustomFieldsValidator
  );

  return { svc, tx, emit, auditService, customFields };
}

describe('ProjectsService.create — custom fields + project.created event', () => {
  it('validates customFields via the service and merges into metadata.customFields', async () => {
    const created = { id: 'p1', projectNumber: 'PROJ-1', metadata: {} };
    const projectCreate = jest.fn(async () => created);
    const tx = {
      project: { count: jest.fn(async () => 0), create: projectCreate },
    };
    const { svc, emit, customFields } = makeService({
      tx,
      validateValues: async () => ({ priority_score: 7 }),
    });

    const result = await svc.create('ws1', user, {
      title: 'T',
      clientName: 'C',
      customFields: { priority_score: '7' },
    } as any);

    // Validator called with (tx, workspaceId, 'PROJECT', incoming).
    expect(customFields!.validateValues).toHaveBeenCalledWith(tx, 'ws1', 'PROJECT', {
      priority_score: '7',
    });
    // Normalized values folded under metadata.customFields; raw key not leaked.
    const data = (projectCreate as jest.Mock).mock.calls[0][0].data;
    expect(data.metadata).toEqual({ customFields: { priority_score: 7 } });
    expect(data.customFields).toBeUndefined();
    // project.created emitted AFTER create with the right payload.
    expect(emit).toHaveBeenCalledWith(PROJECT_CREATED_EVENT, {
      workspaceId: 'ws1',
      projectId: 'p1',
      actorId: 'u1',
      project: created,
    });
    expect(result).toBe(created);
  });

  it('throws BadRequest when customFields supplied but no service is wired', async () => {
    const tx = {
      project: { count: jest.fn(async () => 0), create: jest.fn() },
    };
    const { svc } = makeService({ tx }); // no validateValues

    await expect(
      svc.create('ws1', user, {
        title: 'T',
        clientName: 'C',
        customFields: { note: 'hi' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still emits project.created with no customFields', async () => {
    const created = { id: 'p2', projectNumber: 'PROJ-2' };
    const tx = {
      project: { count: jest.fn(async () => 0), create: jest.fn(async () => created) },
    };
    const { svc, emit } = makeService({ tx });

    await svc.create('ws1', user, { title: 'T', clientName: 'C' } as any);

    expect(emit).toHaveBeenCalledWith(
      PROJECT_CREATED_EVENT,
      expect.objectContaining({ projectId: 'p2', actorId: 'u1' }),
    );
  });

  // The CREATE audit references the project row this transaction just inserted.
  // It has to run on that same tx. A second connection cannot see the
  // uncommitted row, and Postgres rejects it with audit_logs_projectId_fkey.
  it('writes the CREATE audit on the same transaction as the project insert', async () => {
    const created = { id: 'p-new', projectNumber: 'PROJ-2026-000001' };
    const tx = {
      project: { count: jest.fn(async () => 0), create: jest.fn(async () => created) },
    };
    const { svc, auditService } = makeService({ tx });

    await svc.create('ws1', user, { title: 'T', clientName: 'Acme' } as any);

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws1',
        userId: 'u1',
        projectId: 'p-new',
        action: 'CREATE',
        resource: 'Project',
        resourceId: 'p-new',
        details: { projectNumber: 'PROJ-2026-000001' },
      }),
      tx,
    );
  });
});

describe('ProjectsService.updateStatus — project.status_changed event', () => {
  it('emits with the real fromStatus->toStatus, reading the prior status first', async () => {
    const updated = { id: 'p1', projectNumber: 'PROJ-1', status: ProjectStatus.IN_PROGRESS };
    const tx = {
      project: {
        findUnique: jest.fn(async () => ({ status: ProjectStatus.NEW })),
        update: jest.fn(async () => updated),
      },
    };
    const { svc, emit } = makeService({ tx });

    await svc.updateStatus('ws1', user, 'p1', ProjectStatus.IN_PROGRESS);

    expect(emit).toHaveBeenCalledWith(PROJECT_STATUS_CHANGED_EVENT, {
      workspaceId: 'ws1',
      projectId: 'p1',
      fromStatus: ProjectStatus.NEW,
      toStatus: ProjectStatus.IN_PROGRESS,
      actorId: 'u1',
      project: updated,
    });
  });

  it('does NOT emit when the status is unchanged', async () => {
    const tx = {
      project: {
        findUnique: jest.fn(async () => ({ status: ProjectStatus.IN_PROGRESS })),
        update: jest.fn(async () => ({ id: 'p1', status: ProjectStatus.IN_PROGRESS })),
      },
    };
    const { svc, emit } = makeService({ tx });

    await svc.updateStatus('ws1', user, 'p1', ProjectStatus.IN_PROGRESS);

    expect(emit).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.findOne — CLIENT-role quote metadata masking', () => {
  const client = { id: 'c1', email: 'client@x.co', role: 'CLIENT' } as any;
  const staff = { id: 'u1', email: 'a@x.co', role: 'ADMIN' } as any;
  const PROJECT_META = {
    quote: {
      customer_ops_quote_id: 'q-1',
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok',
      schedule_ids: ['sched-1'],
    },
    quoteSummary: { title: 'Order Pad', currency: 'USD', status: 'accepted' },
  };
  const projectRow = () => ({
    id: 'p1',
    projectNumber: 'PROJ-1',
    title: 'Order Pad',
    metadata: PROJECT_META,
    defaultBillRate: '150.0000',
    budgetAmount: '4300.00',
    billingNotes: 'Quote Q-2026-0001 v1',
  });

  it('strips quote foreign ids + commercial columns for a CLIENT caller', async () => {
    const tx = { project: { findUnique: jest.fn(async () => projectRow()) } };
    const { svc } = makeService({ tx });
    const out: any = await svc.findOne('ws1', client, 'p1');
    expect(out.quote).toEqual({
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok',
    });
    expect(out).not.toHaveProperty('defaultBillRate');
    expect(out).not.toHaveProperty('budgetAmount');
    expect(out).not.toHaveProperty('billingNotes');
    const wire = JSON.stringify(out);
    expect(wire).not.toContain('customer_ops_quote_id');
    expect(wire).not.toContain('sched-1');
  });

  it('leaves quote foreign ids + commercial columns for a STAFF caller', async () => {
    const tx = { project: { findUnique: jest.fn(async () => projectRow()) } };
    const { svc } = makeService({ tx });
    const out: any = await svc.findOne('ws1', staff, 'p1');
    expect(out.quote).toEqual(PROJECT_META.quote);
    expect(out.defaultBillRate).toBe('150.0000');
  });
});

describe('ProjectsService.findAll — CLIENT-role masking on the list', () => {
  const client = { id: 'c1', email: 'client@x.co', role: 'CLIENT' } as any;
  const staff = { id: 'u1', email: 'a@x.co', role: 'ADMIN' } as any;
  const PROJECT_META = {
    quote: {
      customer_ops_quote_id: 'q-1',
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok',
      schedule_ids: ['sched-1'],
    },
    quoteSummary: { title: 'Order Pad', currency: 'USD', status: 'accepted' },
  };
  const projectRow = () => ({
    id: 'p1',
    projectNumber: 'PROJ-1',
    title: 'Order Pad',
    metadata: PROJECT_META,
    defaultBillRate: '150.0000',
    budgetAmount: '4300.00',
    budgetHours: '40',
    billingNotes: 'Quote Q-2026-0001 v1',
  });

  const makeListTx = () => ({
    project: {
      findMany: jest.fn(async () => [projectRow()]),
      count: jest.fn(async () => 1),
    },
    task: { groupBy: jest.fn(async () => []) },
    timeEntry: { groupBy: jest.fn(async () => []) },
  });

  it('strips commercial columns + quote ids + budgetSummary for a CLIENT caller', async () => {
    const { svc } = makeService({ tx: makeListTx() });
    const out: any = await svc.findAll('ws1', client, {
      skip: 0,
      take: 20,
      where: {},
      orderBy: { createdAt: 'desc' },
    });
    const p = out.projects[0];
    expect(p).not.toHaveProperty('defaultBillRate');
    expect(p).not.toHaveProperty('budgetAmount');
    expect(p).not.toHaveProperty('budgetHours');
    expect(p).not.toHaveProperty('billingNotes');
    expect(p.budgetSummary).toBeUndefined();
    expect(p.taskStats).toEqual({ total: 0, completed: 0 });
    expect(p.quote).toEqual({
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok',
    });
    const wire = JSON.stringify(p);
    expect(wire).not.toContain('customer_ops_quote_id');
    expect(wire).not.toContain('sched-1');
    expect(wire).not.toContain('150.0000');
    expect(wire).not.toContain('4300');
  });

  it('leaves commercial columns + budgetSummary for a STAFF caller', async () => {
    const { svc } = makeService({ tx: makeListTx() });
    const out: any = await svc.findAll('ws1', staff, {});
    const p = out.projects[0];
    expect(p.defaultBillRate).toBe('150.0000');
    expect(p.budgetSummary.budgetAmount).toBe('4300.00');
    expect(p.budgetSummary.budgetHours).toBe(40);
  });

  it('passes exact federated id filters to both the project page and total count', async () => {
    const tx = makeListTx();
    const { svc } = makeService({ tx });
    const where = {
      customerOpsCustomerId: '550e8400-e29b-41d4-a716-446655440000',
      contactOpsContactId: '6ba7b810-9dad-41d1-80b4-00c04fd430c8',
    };

    await svc.findAll('ws1', staff, { where });

    expect(tx.project.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    expect(tx.project.count).toHaveBeenCalledWith({ where });
  });
});

describe('ProjectsService — safe User selects (never the full User row)', () => {
  const SAFE_USER_SELECT = {
    select: { id: true, email: true, firstName: true, lastName: true },
  };

  it('findOne selects safe User fields for createdBy/assignedTo', async () => {
    const findUnique = jest.fn(async () => ({
      id: 'p1',
      projectNumber: 'PROJ-1',
      metadata: {},
      createdBy: {},
      assignedTo: {},
    }));
    const tx = { project: { findUnique } };
    const { svc } = makeService({ tx });
    await svc.findOne('ws1', user, 'p1');
    const args = (findUnique as jest.Mock).mock.calls[0][0];
    expect(args.include.createdBy).toEqual(SAFE_USER_SELECT);
    expect(args.include.assignedTo).toEqual(SAFE_USER_SELECT);
  });

  it('update selects safe User fields for createdBy/assignedTo', async () => {
    const update = jest.fn(async () => ({ id: 'p1', projectNumber: 'PROJ-1', metadata: {} }));
    const tx = { project: { update } };
    const { svc } = makeService({ tx });
    await svc.update('ws1', user, 'p1', { title: 'T' } as any);
    const args = (update as jest.Mock).mock.calls[0][0];
    expect(args.include.createdBy).toEqual(SAFE_USER_SELECT);
    expect(args.include.assignedTo).toEqual(SAFE_USER_SELECT);
  });

  it('updateStatus selects safe User fields for createdBy/assignedTo', async () => {
    const update = jest.fn(async () => ({
      id: 'p1',
      projectNumber: 'PROJ-1',
      status: ProjectStatus.IN_PROGRESS,
    }));
    const tx = {
      project: {
        findUnique: jest.fn(async () => ({ status: ProjectStatus.NEW })),
        update,
      },
    };
    const { svc } = makeService({ tx });
    await svc.updateStatus('ws1', user, 'p1', ProjectStatus.IN_PROGRESS);
    const args = (update as jest.Mock).mock.calls[0][0];
    expect(args.include.createdBy).toEqual(SAFE_USER_SELECT);
    expect(args.include.assignedTo).toEqual(SAFE_USER_SELECT);
  });

  it('create selects safe User fields for createdBy/assignedTo', async () => {
    const created = { id: 'p1', projectNumber: 'PROJ-1', metadata: {} };
    const create = jest.fn(async () => created);
    const tx = { project: { count: jest.fn(async () => 0), create } };
    const { svc } = makeService({ tx });
    await svc.create('ws1', user, { title: 'T', clientName: 'C' } as any);
    const args = (create as jest.Mock).mock.calls[0][0];
    expect(args.include.createdBy).toEqual(SAFE_USER_SELECT);
    expect(args.include.assignedTo).toEqual(SAFE_USER_SELECT);
  });
});

describe('ProjectsService.update — invoiced flat-fee immutability', () => {
  it('rejects changing a project flat fee after it was invoiced', async () => {
    const update = jest.fn(async () => ({ id: 'p1' }));
    const findUnique = jest.fn(async () => ({
      flatFeeAmount: '1250.00',
      flatFeeInvoicedAt: new Date('2026-09-30T12:00:00Z'),
    }));
    const { svc } = makeService({ tx: { project: { findUnique, update } } });

    await expect(svc.update('ws1', user, 'p1', { flatFeeAmount: 1251 } as any)).rejects.toThrow(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('allows an idempotent rewrite of the same invoiced flat fee', async () => {
    const update = jest.fn(async () => ({ id: 'p1' }));
    const findUnique = jest.fn(async () => ({
      flatFeeAmount: '1250.00',
      flatFeeInvoicedAt: new Date('2026-09-30T12:00:00Z'),
    }));
    const { svc } = makeService({ tx: { project: { findUnique, update } } });

    await svc.update('ws1', user, 'p1', { flatFeeAmount: 1250 } as any);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('ProjectsService.clone', () => {
  const cloneUser = {
    id: 'operator-1',
    email: 'operator@fictional.example.com',
    role: 'ADMIN',
    keycloakId: null,
  } as any;

  const sourceProject = {
    id: 'roadmap-template',
    workspaceId: 'workspace-a',
    projectNumber: 'PROJ-2026-000001',
    title: 'Fictional Accelerator Roadmap',
    description: 'Three phases for a fictional cohort company.',
    clientName: 'Example Ventures',
    priority: 'HIGH',
    category: 'ACCELERATOR',
    tags: ['roadmap'],
    metadata: { template: true },
    status: 'IN_PROGRESS',
    dueDate: new Date('2026-01-31T00:00:00.000Z'),
    createdAt: new Date('2025-12-20T00:00:00.000Z'),
    assignedToId: 'allowed-assignee',
    contactId: null,
    organizationId: null,
    billByDefault: true,
    defaultBillRate: null,
    budgetHours: null,
    budgetAmount: null,
    roundingIncrementMinutes: null,
    roundingMode: null,
  } as any;

  function makeCloneHarness(overrides: { sourceProject?: any; targetWorkspace?: string } = {}) {
    const sourceTx = {
      project: {
        findFirst: jest.fn(async () =>
          overrides.sourceProject !== undefined ? overrides.sourceProject : sourceProject,
        ),
      },
      task: {
        findMany: jest.fn(async () => [
          {
            id: 'task-child',
            title: 'Phase child',
            description: 'Child task',
            type: 'TASK',
            status: 'COMPLETED',
            priority: 'MEDIUM',
            dueDate: new Date('2026-01-08T00:00:00.000Z'),
            createdAt: new Date('2026-01-02T00:00:00.000Z'),
            parentTaskId: 'task-root',
            assignedToId: 'foreign-assignee',
            recurrenceRule: null,
            recurrenceParentId: null,
            estimatedHours: 2,
            fixedAmount: null,
            billable: null,
            billRate: null,
            metadata: { customFields: { phase: 'launch', removed_key: 'drop me' } },
          },
          {
            id: 'task-root',
            title: 'Phase root',
            description: 'Root task',
            type: 'MILESTONE',
            status: 'IN_PROGRESS',
            priority: 'HIGH',
            dueDate: new Date('2026-01-01T00:00:00.000Z'),
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            parentTaskId: null,
            assignedToId: 'allowed-assignee',
            recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1',
            recurrenceParentId: null,
            estimatedHours: 4,
            fixedAmount: 100,
            billable: true,
            billRate: 80,
            metadata: { phase: 'discovery' },
          },
        ]),
      },
      taskDependency: {
        findMany: jest.fn(async () => [
          {
            predecessorId: 'task-root',
            successorId: 'task-child',
            type: 'FINISH_TO_START',
          },
          {
            predecessorId: 'external-task',
            successorId: 'task-root',
            type: 'START_TO_START',
          },
        ]),
      },
    };
    const targetTaskCreates: any[] = [];
    const targetTx = {
      project: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({
          ...sourceProject,
          ...data,
          id: 'cloned-roadmap',
          projectNumber: 'PROJ-2026-000002',
        })),
      },
      task: {
        create: jest.fn(async ({ data }: any) => {
          const id = data.title === 'Phase root' ? 'cloned-root' : 'cloned-child';
          const created = { id, ...data };
          targetTaskCreates.push(created);
          return created;
        }),
      },
      taskDependency: {
        create: jest.fn(async ({ data }: any) => ({ id: 'cloned-dependency', ...data })),
      },
      membership: {
        findMany: jest.fn(async () => [{ userKey: 'allowed-assignee' }]),
      },
      user: {
        findMany: jest.fn(async () => [
          { id: 'allowed-assignee', keycloakId: null },
          { id: 'foreign-assignee', keycloakId: null },
        ]),
      },
      customFieldDefinition: {
        findMany: jest.fn(async () => [{ entity: 'TASK', key: 'phase' }]),
      },
    };
    const workspaceContext = {
      resolveAuthorized: jest.fn(async () => 'workspace-a'),
      assertCanWrite: jest.fn(async () => undefined),
      runForUser: jest.fn(async (_u: any, fn: (tx: any) => any, workspaceId: string) =>
        fn(workspaceId === (overrides.targetWorkspace ?? 'workspace-a') ? targetTx : sourceTx),
      ),
    };
    const emit = jest.fn();
    const auditService = { log: jest.fn(async () => undefined) };
    const membership = { isTenancyEnabled: jest.fn(() => true) };
    let runCount = 0;
    const svc = new ProjectsService(
      {} as any,
      auditService as any,
      workspaceContext as any,
      { emit } as any,
      undefined,
      membership as any,
    );
    workspaceContext.runForUser.mockImplementation(async (_u: any, fn: (tx: any) => any) =>
      fn(++runCount === 1 ? sourceTx : targetTx),
    );
    return { svc, sourceTx, targetTx, targetTaskCreates, workspaceContext, emit, auditService };
  }

  it('copies the tree, remaps parents/dependencies, shifts dates, and suppresses task events', async () => {
    const h = makeCloneHarness({ targetWorkspace: 'workspace-b' });

    const result = await h.svc.clone(
      cloneUser,
      'roadmap-template',
      { targetWorkspaceId: 'workspace-b', startDate: '2026-02-01', dueDateMode: 'shift' },
      'workspace-a',
    );

    expect(result).toMatchObject({
      taskCount: 2,
      dependencyCount: 1,
      skipped: { dependencies: 1, assignees: 1, customFields: 1 },
    });
    expect(h.targetTaskCreates.map((task) => task.id)).toEqual(['cloned-root', 'cloned-child']);
    expect(h.targetTaskCreates[0]).toMatchObject({
      parentTaskId: null,
      status: 'PENDING',
      dueDate: new Date('2026-02-01T00:00:00.000Z'),
      recurrenceRule: 'FREQ=MONTHLY;INTERVAL=1',
    });
    expect(h.targetTaskCreates[1]).toMatchObject({
      parentTaskId: 'cloned-root',
      assignedToId: null,
      dueDate: new Date('2026-02-08T00:00:00.000Z'),
      metadata: { customFields: { phase: 'launch' } },
    });
    expect(h.targetTx.taskDependency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        predecessorId: 'cloned-root',
        successorId: 'cloned-child',
        workspaceId: 'workspace-b',
      }),
    });
    expect(h.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', projectId: 'cloned-roadmap' }),
      h.targetTx,
    );
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(h.emit.mock.calls[0][0]).toBe(PROJECT_CREATED_EVENT);
  });

  it('clears task dates when dueDateMode is clear', async () => {
    const h = makeCloneHarness();
    await h.svc.clone(cloneUser, 'roadmap-template', { dueDateMode: 'clear' }, 'workspace-a');

    expect(h.targetTaskCreates.every((task) => task.dueDate === null)).toBe(true);
  });

  it('returns not found when the source is outside the caller visibility filter', async () => {
    const h = makeCloneHarness({ sourceProject: null });
    await expect(
      h.svc.clone(cloneUser, 'hidden-project', {}, 'workspace-a'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.targetTx.project.create).not.toHaveBeenCalled();
  });

  it('rejects a target workspace where the caller cannot create', async () => {
    const h = makeCloneHarness({ targetWorkspace: 'workspace-b' });
    h.workspaceContext.assertCanWrite.mockRejectedValue(new ForbiddenException('target denied'));

    await expect(
      h.svc.clone(
        cloneUser,
        'roadmap-template',
        { targetWorkspaceId: 'workspace-b' },
        'workspace-a',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.targetTx.project.create).not.toHaveBeenCalled();
  });
});
