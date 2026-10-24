import { AuditService } from './audit.service';
import { AuditAction } from '@prisma/client';

/**
 * AuditService.log must write a row that references a just-inserted parent on
 * the caller's transaction. Opening runInWorkspace for that write uses a
 * second pooled connection, which cannot see the uncommitted parent, and
 * Postgres rejects it with audit_logs_projectId_fkey.
 */

const dto = {
  workspaceId: 'ws1',
  userId: 'u1',
  projectId: 'p-new',
  action: AuditAction.CREATE,
  resource: 'Project',
  resourceId: 'p-new',
  details: { projectNumber: 'PROJ-2026-000001' },
};

function makeService(opts?: {
  txCreate?: jest.Mock;
  runInWorkspace?: jest.Mock;
  prismaCreate?: jest.Mock;
}) {
  const txCreate = opts?.txCreate ?? jest.fn(async ({ data }) => ({ id: 'audit-1', ...data }));
  const callerTx = { auditLog: { create: txCreate } };
  const runInWorkspace =
    opts?.runInWorkspace ??
    jest.fn(async (_ws: string, _uid: string, fn: (t: any) => any) =>
      fn({ auditLog: { create: jest.fn(async () => ({ id: 'audit-other' })) } }),
    );
  const prismaCreate = opts?.prismaCreate ?? jest.fn(async () => ({ id: 'audit-bare' }));
  const svc = new AuditService(
    { auditLog: { create: prismaCreate } } as any,
    { runInWorkspace } as any,
  );
  return { svc, callerTx, txCreate, runInWorkspace, prismaCreate };
}

describe('AuditService.log', () => {
  it('writes on the caller transaction and does not open a second connection', async () => {
    const { svc, callerTx, txCreate, runInWorkspace, prismaCreate } = makeService();

    const row = await svc.log(dto, callerTx as any);

    expect(row).toMatchObject({ id: 'audit-1', projectId: 'p-new' });
    expect(txCreate).toHaveBeenCalledWith({ data: dto });
    expect(runInWorkspace).not.toHaveBeenCalled();
    expect(prismaCreate).not.toHaveBeenCalled();
  });

  it('rethrows a failure on the caller transaction instead of swallowing it', async () => {
    const fk = new Error('Foreign key constraint violated: audit_logs_projectId_fkey (index)');
    const { svc, callerTx } = makeService({
      txCreate: jest.fn(async () => {
        throw fk;
      }),
    });

    await expect(svc.log(dto, callerTx as any)).rejects.toBe(fk);
  });

  it('still uses runInWorkspace when no caller transaction is passed', async () => {
    const { svc, runInWorkspace, prismaCreate } = makeService();

    const row = await svc.log(dto);

    expect(row).toMatchObject({ id: 'audit-other' });
    expect(runInWorkspace).toHaveBeenCalledWith('ws1', 'u1', expect.any(Function));
    expect(prismaCreate).not.toHaveBeenCalled();
  });

  it('logs and returns null when a standalone write fails', async () => {
    const { svc } = makeService({
      runInWorkspace: jest.fn(async () => {
        throw new Error('connection reset');
      }),
    });

    await expect(svc.log(dto)).resolves.toBeNull();
  });

  it('falls back to a bare create when the DTO has no workspaceId', async () => {
    const { svc, runInWorkspace, prismaCreate } = makeService();
    const unscoped = { ...dto, workspaceId: undefined };

    await svc.log(unscoped);

    expect(prismaCreate).toHaveBeenCalledWith({ data: unscoped });
    expect(runInWorkspace).not.toHaveBeenCalled();
  });
});
