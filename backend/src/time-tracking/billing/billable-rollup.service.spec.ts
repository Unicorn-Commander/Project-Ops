import { UserRole } from '@prisma/client';
import { BillableRollupService } from './billable-rollup.service';
import { BillableDraftAssembler } from './billable-draft.assembler';
import { BillableGroupBy } from '../dto/create-billable-draft.dto';

const user = { id: 'u1', email: 'manager@example.com', role: UserRole.ADMIN } as any;

function makeService(options: {
  createResult: any;
  issueResult?: any;
  entries?: any[];
  projects?: any[];
  tasks?: any[];
}) {
  const entryProject = {
    id: 'p1',
    projectNumber: 'P-1',
    title: 'Project One',
    clientName: 'Client One',
    clientEmail: 'client@example.com',
    contactId: null,
    contact: null,
  };
  const project = {
    id: 'p1',
    projectNumber: 'P-1',
    title: 'Project One',
    flatFeeAmount: null,
    flatFeeInvoicedAt: null,
    customerOpsCustomerId: null,
    contactOpsContactId: null,
    clientName: 'Client One',
    clientEmail: 'client@example.com',
    contactId: null,
    contact: null,
  };
  const entry = {
    id: 'entry-1',
    startedAt: new Date('2026-10-01T10:00:00Z'),
    description: 'Implementation',
    roundingAppliedSeconds: 3600,
    durationSeconds: 3600,
    billRateApplied: '100.00',
    billableAmount: '100.00',
    currency: 'USD',
    taskId: null,
    userId: 'u1',
    task: null,
    user: { role: UserRole.STAFF },
    project: entryProject,
  };
  const tx = {
    timeEntry: {
      findMany: jest.fn(async () => options.entries ?? [entry]),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    project: {
      findMany: jest.fn(async () => options.projects ?? [project]),
      update: jest.fn(async (args: any) => args),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    task: {
      findMany: jest.fn(async () => options.tasks ?? []),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    contact: { findUnique: jest.fn(async () => null) },
  };
  const workspaceContext = {
    runForUser: jest.fn(async (_user: any, fn: (scopedTx: any) => any) => fn(tx)),
  };
  const ao = {
    isLive: jest.fn(() => true),
    createInvoiceFromDraft: jest.fn(async () => options.createResult),
    issueInvoice: jest.fn(async () => options.issueResult),
    getInvoice: jest.fn(),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const events = { emit: jest.fn() };
  const config = { get: jest.fn((_key: string, fallback: string) => fallback) };
  const pdf = {
    renderAndStore: jest.fn(async () => ({ previewUrl: 'https://files/preview.pdf' })),
  };
  const svc = new BillableRollupService(
    {} as any,
    audit as any,
    events as any,
    config as any,
    new BillableDraftAssembler(),
    pdf as any,
    ao as any,
    workspaceContext as any,
  );
  return { svc, tx, ao, audit, events, pdf };
}

const draftInvoice = {
  ok: true,
  invoice: {
    id: 'ao-invoice-1',
    invoiceNumber: 'INV-1',
    status: 'draft',
    total: '100.00',
  },
};

describe('BillableRollupService flat-fee issue boundary', () => {
  it('previews without issuing or stamping', async () => {
    const { svc, ao, tx } = makeService({ createResult: draftInvoice });

    const result = await svc.createBillableDraft(
      'ws-1',
      user,
      { projectId: 'p1', groupBy: BillableGroupBy.TASK } as any,
      { bearerToken: 'token' },
    );

    expect(result.status).toBe('DRAFT');
    expect(ao.issueInvoice).not.toHaveBeenCalled();
    expect(tx.timeEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('issues first, then stamps and preserves the AO decimal string', async () => {
    const { svc, ao, tx } = makeService({
      createResult: {
        ok: true,
        invoice: { ...draftInvoice.invoice, total: '12345678.90' },
      },
      issueResult: {
        ok: true,
        invoice: {
          ...draftInvoice.invoice,
          status: 'issued',
          total: '12345678.90',
        },
      },
    });

    const result = await svc.createBillableDraft(
      'ws-1',
      user,
      { projectId: 'p1', issue: true } as any,
      { bearerToken: 'token' },
    );

    expect(result.status).toBe('INVOICED');
    expect(ao.issueInvoice).toHaveBeenCalledWith('ao-invoice-1', { bearerToken: 'token' });
    expect(tx.timeEntry.updateMany).toHaveBeenCalled();
    expect(tx.project.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ billingAmount: '12345678.90' }) }),
    );
  });

  it('does not stamp when Accounting-Ops rejects the issue', async () => {
    const { svc, tx } = makeService({
      createResult: draftInvoice,
      issueResult: {
        ok: false,
        reason: 'UNREACHABLE',
        message: 'Accounting-Ops is unreachable right now.',
      },
    });

    const result = await svc.createBillableDraft(
      'ws-1',
      user,
      { projectId: 'p1', issue: true } as any,
      { bearerToken: 'token' },
    );

    expect(result.status).toBe('DRAFT');
    expect(tx.timeEntry.updateMany).not.toHaveBeenCalled();
    expect(tx.project.update).not.toHaveBeenCalled();
  });

  it('does not issue an invoice AO already reports as posted', async () => {
    const { svc, ao, tx } = makeService({
      createResult: {
        ok: true,
        invoice: { ...draftInvoice.invoice, status: 'issued' },
      },
    });

    const result = await svc.createBillableDraft(
      'ws-1',
      user,
      { projectId: 'p1', issue: true } as any,
      { bearerToken: 'token' },
    );

    expect(result.status).toBe('INVOICED');
    expect(ao.issueInvoice).not.toHaveBeenCalled();
    expect(tx.timeEntry.updateMany).toHaveBeenCalledTimes(1);
  });
});
