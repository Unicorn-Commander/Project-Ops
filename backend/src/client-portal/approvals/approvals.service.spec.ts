import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApprovalsService } from './approvals.service';
import { ClientApprovalStatus } from '@prisma/client';

/**
 * Unit tests for the portal ApprovalsService scoping invariants.
 *
 * Core guarantee under test: a portal CLIENT can only DECIDE an approval that
 * belongs to THEIR contact — either addressed to them (approverContactId) or
 * unaddressed and on a project their contact owns. Anything else 404s, and an
 * already-decided approval can't be changed.
 */

type TxShape = {
  contact: { findUnique: jest.Mock };
  approval: { findUnique: jest.Mock; update: jest.Mock; findMany?: jest.Mock; count?: jest.Mock };
  project: { findMany?: jest.Mock; findUnique?: jest.Mock };
};

function makeService(tx: Partial<TxShape>) {
  const workspaceContext = {
    // Invoke fn with the supplied tx, exactly like withWorkspace would.
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
    runInWorkspace: jest.fn(async (_w: any, _u: any, fn: (t: any) => any) => fn(tx)),
  };
  const audit = { log: jest.fn(async () => null) };

  const svc = new ApprovalsService(workspaceContext as any, audit as any);
  return { svc, audit };
}

const clientUser = { id: 'user-A', email: 'client@a.co', keycloakId: 'kc-A' } as any;

describe('ApprovalsService.decide — cross-org / ownership scoping', () => {
  it("404s when the approval belongs to ANOTHER org's project (client cannot decide it)", async () => {
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      approval: {
        // Unaddressed approval, but the linked project is owned by contact-B.
        findUnique: jest.fn(async () => ({
          id: 'appr-1',
          approverContactId: null,
          status: ClientApprovalStatus.PENDING,
          projectId: 'proj-B',
          project: { id: 'proj-B', contactId: 'contact-B' },
        })),
        update: jest.fn(),
      },
    };
    const { svc } = makeService(tx);

    await expect(
      svc.decide('ws1', clientUser, 'appr-1', {
        decision: ClientApprovalStatus.APPROVED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    // Critically: the update must NEVER run for a foreign-org approval.
    expect(tx.approval!.update).not.toHaveBeenCalled();
  });

  it('404s when the approval is addressed to a DIFFERENT contact', async () => {
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      approval: {
        findUnique: jest.fn(async () => ({
          id: 'appr-2',
          approverContactId: 'contact-B', // addressed to someone else
          status: ClientApprovalStatus.PENDING,
          projectId: 'proj-A',
          project: { id: 'proj-A', contactId: 'contact-A' },
        })),
        update: jest.fn(),
      },
    };
    const { svc } = makeService(tx);

    await expect(
      svc.decide('ws1', clientUser, 'appr-2', {
        decision: ClientApprovalStatus.REJECTED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.approval!.update).not.toHaveBeenCalled();
  });

  it('decides an approval the client owns (unaddressed, on their project) and stamps the decision', async () => {
    const update = jest.fn(async (args: any) => ({
      id: 'appr-3',
      ...args.data,
      projectId: 'proj-A',
      project: { id: 'proj-A', projectNumber: 'P-1', title: 'Site' },
    }));
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      approval: {
        findUnique: jest.fn(async () => ({
          id: 'appr-3',
          approverContactId: null,
          status: ClientApprovalStatus.PENDING,
          projectId: 'proj-A',
          project: { id: 'proj-A', contactId: 'contact-A' },
        })),
        update,
      },
    };
    const { svc, audit } = makeService(tx);

    const out = await svc.decide('ws1', clientUser, 'appr-3', {
      decision: ClientApprovalStatus.CHANGES_REQUESTED,
      note: 'Please tweak the header.',
    });

    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe(ClientApprovalStatus.CHANGES_REQUESTED);
    expect(data.decisionNote).toBe('Please tweak the header.');
    expect(data.decidedByContactId).toBe('contact-A'); // the signed-in contact
    expect(data.decidedAt).toBeInstanceOf(Date);
    expect(out.status).toBe(ClientApprovalStatus.CHANGES_REQUESTED);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('403s when the approval is already decided (not PENDING)', async () => {
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      approval: {
        findUnique: jest.fn(async () => ({
          id: 'appr-4',
          approverContactId: 'contact-A',
          status: ClientApprovalStatus.APPROVED, // already decided
          projectId: 'proj-A',
          project: { id: 'proj-A', contactId: 'contact-A' },
        })),
        update: jest.fn(),
      },
    };
    const { svc } = makeService(tx);

    await expect(
      svc.decide('ws1', clientUser, 'appr-4', {
        decision: ClientApprovalStatus.REJECTED,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.approval!.update).not.toHaveBeenCalled();
  });

  it('404s when the user has no contact profile', async () => {
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn(async () => null) },
      approval: { findUnique: jest.fn(), update: jest.fn() },
    };
    const { svc } = makeService(tx);

    await expect(
      svc.decide('ws1', clientUser, 'appr-5', {
        decision: ClientApprovalStatus.APPROVED,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.approval!.findUnique).not.toHaveBeenCalled();
  });
});

describe('ApprovalsService.listForContact — owned-approvals filter', () => {
  it("builds an OR over (addressed-to-me) + (unaddressed on my projects) and never leaks other orgs", async () => {
    const findMany = jest.fn(async (_args: any) => [] as any[]);
    const count = jest.fn(async (_args?: any) => 0);
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn(async () => ({ id: 'contact-A' })) },
      project: { findMany: jest.fn(async () => [{ id: 'proj-A' }, { id: 'proj-A2' }]) },
      approval: { findUnique: jest.fn(), update: jest.fn(), findMany, count },
    };
    const { svc } = makeService(tx);

    await svc.listForContact('ws1', clientUser, { status: ClientApprovalStatus.PENDING });

    const where = (findMany.mock.calls[0][0] as any).where;
    expect(where.status).toBe(ClientApprovalStatus.PENDING);
    expect(where.OR).toEqual([
      { approverContactId: 'contact-A' },
      { approverContactId: null, projectId: { in: ['proj-A', 'proj-A2'] } },
    ]);
  });
});

describe('ApprovalsService.request — staff create', () => {
  it('stamps workspaceId + requestedById and defaults status to PENDING', async () => {
    const create = jest.fn(async (args: any) => ({ id: 'appr-new', ...args.data }));
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn() },
      project: { findUnique: jest.fn(async () => ({ id: 'proj-A' })) },
      approval: { findUnique: jest.fn(), update: jest.fn() },
    };
    (tx.approval as any).create = create;
    const staffUser = { id: 'staff-1', email: 's@a.co' } as any;
    const { svc } = makeService(tx);

    await svc.request('ws1', staffUser, {
      entityType: 'DOCUMENT' as any,
      entityId: 'doc-9',
      projectId: 'proj-A',
    });

    const data = create.mock.calls[0][0].data;
    expect(data.workspaceId).toBe('ws1');
    expect(data.requestedById).toBe('staff-1');
    expect(data.status).toBe(ClientApprovalStatus.PENDING);
    expect(data.entityId).toBe('doc-9');
  });

  it('404s when the linked project is not visible in the workspace', async () => {
    const tx: Partial<TxShape> = {
      contact: { findUnique: jest.fn() },
      project: { findUnique: jest.fn(async () => null) },
      approval: { findUnique: jest.fn(), update: jest.fn() },
    };
    (tx.approval as any).create = jest.fn();
    const staffUser = { id: 'staff-1', email: 's@a.co' } as any;
    const { svc } = makeService(tx);

    await expect(
      svc.request('ws1', staffUser, {
        entityType: 'DOCUMENT' as any,
        entityId: 'doc-9',
        projectId: 'ghost-proj',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((tx.approval as any).create).not.toHaveBeenCalled();
  });
});
