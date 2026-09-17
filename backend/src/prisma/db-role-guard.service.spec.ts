/**
 * Tests for the boot-time DB-role self-check (item 2).
 *
 * Contract:
 *   - BYPASSRLS role + tenancy ON   -> throw (refuse to boot)
 *   - BYPASSRLS role + tenancy OFF  -> warn, continue (today's owner deploy)
 *   - NOBYPASSRLS role              -> pass
 *   - query failure + tenancy ON    -> throw (cannot prove RLS enforces)
 */
import { DbRoleGuardService } from './db-role-guard.service';
import { PrismaService } from './prisma.service';
import { ConfigService } from '@nestjs/config';

const makeService = (queryResult: any, tenancyEnabled: boolean, queryThrows = false) => {
  const prisma = {
    $queryRawUnsafe: jest.fn(async () => {
      if (queryThrows) throw new Error('connection refused');
      return queryResult;
    }),
  } as unknown as PrismaService;

  const config = {
    get: (k: string) =>
      k === 'PROJECT_OPS_TENANCY_ENABLED' ? (tenancyEnabled ? 'true' : 'false') : undefined,
  } as ConfigService;

  return new DbRoleGuardService(prisma, config);
};

describe('DbRoleGuardService', () => {
  it('passes for a NOBYPASSRLS role (tenancy ON)', async () => {
    const svc = makeService([{ current_user: 'project_ops_app', rolbypassrls: false }], true);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('REFUSES TO BOOT for a BYPASSRLS role when tenancy is ON', async () => {
    const svc = makeService([{ current_user: 'project_ops_admin', rolbypassrls: true }], true);
    await expect(svc.onModuleInit()).rejects.toThrow(/BYPASSRLS/);
  });

  it('only WARNS for a BYPASSRLS role when tenancy is OFF (today)', async () => {
    const svc = makeService([{ current_user: 'project_ops_admin', rolbypassrls: true }], false);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('REFUSES TO BOOT when the role query fails and tenancy is ON', async () => {
    const svc = makeService(null, true, true);
    await expect(svc.onModuleInit()).rejects.toThrow(/cannot be confirmed|Could not verify/);
  });

  it('tolerates a query failure when tenancy is OFF', async () => {
    const svc = makeService(null, false, true);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
  });

  it('REFUSES TO BOOT when no row is returned and tenancy is ON', async () => {
    const svc = makeService([], true);
    await expect(svc.onModuleInit()).rejects.toThrow(/no row|Refusing to boot/);
  });
});
