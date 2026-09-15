import {
  ProjectsService,
  PROJECT_CREATED_EVENT,
  PROJECT_STATUS_CHANGED_EVENT,
} from './projects.service';
import { ProjectStatus } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

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
});
