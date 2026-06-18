import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClientPortalService } from './client-portal.service';

/**
 * Unit tests for the two-way additions to ClientPortalService:
 *   - a portal client comment is ALWAYS non-internal and on a project they own
 *   - the invoice projection only emits a payUrl when there is an open balance
 */

function makeService(tx: any) {
  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
    runInWorkspace: jest.fn(async (_w: any, _u: any, fn: (t: any) => any) => fn(tx)),
  };
  const audit = { log: jest.fn(async () => null) };
  const events = { emit: jest.fn(() => true) };
  const svc = new ClientPortalService(workspaceContext as any, audit as any, events as any);
  return { svc, events };
}

const clientUser = { id: 'user-A', email: 'c@a.co', keycloakId: 'kc-A' } as any;

describe('ClientPortalService.createProjectComment', () => {
  it('forces isInternal=false and authors as the client, on their own project', async () => {
    const create = jest.fn(async (args: any) => ({
      id: 'c1',
      ...args.data,
      author: { id: 'user-A', firstName: 'Cli', lastName: 'Ent', role: 'CLIENT' },
    }));
    const tx = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      project: { findUnique: jest.fn(async () => ({ id: 'proj-A', contactId: 'contact-A' })) },
      comment: { create },
    };
    const { svc, events } = makeService(tx);

    const out = await svc.createProjectComment('ws1', clientUser, 'proj-A', {
      content: 'Looks good',
    });

    const data = create.mock.calls[0][0].data;
    expect(data.isInternal).toBe(false);
    expect(data.authorId).toBe('user-A');
    expect(data.projectId).toBe('proj-A');
    expect(data.workspaceId).toBe('ws1');
    expect(out.isInternal).toBe(false);
    // Realtime parity: emits the same event the comments module uses.
    expect(events.emit).toHaveBeenCalledWith(
      'comment.created',
      expect.objectContaining({ workspaceId: 'ws1', projectId: 'proj-A' }),
    );
  });

  it("403s when the project belongs to a different contact", async () => {
    const create = jest.fn();
    const tx = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      project: { findUnique: jest.fn(async () => ({ id: 'proj-B', contactId: 'contact-B' })) },
      comment: { create },
    };
    const { svc } = makeService(tx);

    await expect(
      svc.createProjectComment('ws1', clientUser, 'proj-B', { content: 'hi' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('404s when the project does not resolve under the workspace scope', async () => {
    const tx = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      project: { findUnique: jest.fn(async () => null) },
      comment: { create: jest.fn() },
    };
    const { svc } = makeService(tx);

    await expect(
      svc.createProjectComment('ws1', clientUser, 'ghost', { content: 'hi' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClientPortalService.getInvoices — payUrl deep-link stub', () => {
  function invoiceTx(projects: any[]) {
    return {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      project: { findMany: jest.fn(async () => projects) },
    };
  }

  it('emits a payUrl ONLY when there is an outstanding balance', async () => {
    const tx = invoiceTx([
      {
        id: 'proj-A',
        projectNumber: 'P-1',
        title: 'Open',
        invoiceNumber: 'INV-1',
        billingAmount: '1000.00',
        amountPaid: '250.00',
        paymentStatus: 'PARTIALLY_PAID',
      },
    ]);
    const { svc } = makeService(tx);

    const [inv] = await svc.getInvoices('ws1', clientUser);
    expect(inv.balanceDue).toBe(750);
    expect(inv.payUrl).toBe('/client-portal/invoices/proj-A/pay');
  });

  it('emits null payUrl when fully paid', async () => {
    const tx = invoiceTx([
      {
        id: 'proj-B',
        projectNumber: 'P-2',
        title: 'Paid',
        invoiceNumber: 'INV-2',
        billingAmount: '500.00',
        amountPaid: '500.00',
        paymentStatus: 'PAID',
      },
    ]);
    const { svc } = makeService(tx);

    const [inv] = await svc.getInvoices('ws1', clientUser);
    expect(inv.balanceDue).toBe(0);
    expect(inv.payUrl).toBeNull();
  });

  it('emits null payUrl when the balance is open but the invoice is CANCELLED', async () => {
    const tx = invoiceTx([
      {
        id: 'proj-C',
        projectNumber: 'P-3',
        title: 'Void',
        invoiceNumber: 'INV-3',
        billingAmount: '500.00',
        amountPaid: '0.00',
        paymentStatus: 'CANCELLED',
      },
    ]);
    const { svc } = makeService(tx);

    const [inv] = await svc.getInvoices('ws1', clientUser);
    expect(inv.payUrl).toBeNull();
  });
});
