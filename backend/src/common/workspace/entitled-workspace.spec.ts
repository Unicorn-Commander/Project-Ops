import { ConfigService } from '@nestjs/config';
import { MembershipStatus, User, WorkspaceRole } from '@prisma/client';
import { MembershipService } from './membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { __resetAccessListCacheForTests } from '../../auth/access-list';

const BOOTSTRAP = '0190a000-7e57-7000-8000-00000000b007';
const CUSTOMER_ORG = '01924a3c-0000-7f1a-beef-6700000000ff';

/**
 * Self-serve onboarding (ensureEntitledWorkspace).
 *
 * Project-Ops is sold inside both paid Suite tiers, so a customer who just
 * subscribed must be able to USE it without a human editing
 * PROJECT_OPS_ACCESS_LIST and restarting the container. These tests pin the two
 * properties that make that safe:
 *
 *   1. A new entitled org gets its OWN workspace — NEVER the operator's
 *      bootstrap tenant. Seeding a customer into the bootstrap workspace would
 *      be a cross-tenant leak, not an onboarding.
 *   2. Provisioning is idempotent on org_id, so the second user of an org joins
 *      the SAME workspace rather than minting a second one.
 */
describe('MembershipService.ensureEntitledWorkspace', () => {
  const customer = {
    id: 'local-customer',
    email: 'owner@newcustomer.example',
    keycloakId: 'kc-customer-sub',
  } as User;

  const colleague = {
    id: 'local-colleague',
    email: 'staff@newcustomer.example',
    keycloakId: 'kc-colleague-sub',
  } as User;

  function make(env: Record<string, string | undefined>, prismaMock: any) {
    const config = {
      get: (k: string, def?: unknown) => (k in env ? env[k] : def),
    } as unknown as ConfigService;
    return new MembershipService(prismaMock as PrismaService, config);
  }

  /** An in-memory stand-in for the workspaces + memberships control-plane. */
  function fakePrisma() {
    const workspaces: any[] = [];
    const memberships: any[] = [];
    return {
      _workspaces: workspaces,
      _memberships: memberships,
      workspace: {
        findUnique: jest.fn(async ({ where }: any) =>
          workspaces.find(
            (w) =>
              (where.id !== undefined && w.id === where.id) ||
              (where.slug !== undefined && w.slug === where.slug),
          ) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          if (workspaces.some((w) => w.id === data.id || w.slug === data.slug)) {
            throw new Error('unique constraint');
          }
          workspaces.push({ ...data });
          return { ...data };
        }),
      },
      membership: {
        findFirst: jest.fn(async ({ where }: any) =>
          memberships.find((m) => m.userKey === where.userKey) ?? null,
        ),
        upsert: jest.fn(async ({ where, create }: any) => {
          const k = where.userKey_workspaceId;
          const found = memberships.find(
            (m) => m.userKey === k.userKey && m.workspaceId === k.workspaceId,
          );
          if (found) {
            found.status = MembershipStatus.ACTIVE;
            return found;
          }
          memberships.push({ ...create });
          return { ...create };
        }),
      },
    };
  }

  beforeEach(() => {
    __resetAccessListCacheForTests();
    delete process.env.PROJECT_OPS_ACCESS_LIST;
  });

  const ENV_ON = {
    PROJECT_OPS_TENANCY_ENABLED: 'true',
    DEFAULT_WORKSPACE_ID: BOOTSTRAP,
  };

  it('is inert while tenancy is disabled', async () => {
    const prisma = fakePrisma();
    const svc = make({ DEFAULT_WORKSPACE_ID: BOOTSTRAP }, prisma);
    const id = await svc.ensureEntitledWorkspace(customer, CUSTOMER_ORG, 'ADMIN');
    expect(id).toBeNull();
    expect(prisma.workspace.create).not.toHaveBeenCalled();
  });

  it('returns null when the entitlement carries no org id', async () => {
    const prisma = fakePrisma();
    const svc = make(ENV_ON, prisma);
    expect(await svc.ensureEntitledWorkspace(customer, null, 'ADMIN')).toBeNull();
    expect(await svc.ensureEntitledWorkspace(customer, '   ', 'ADMIN')).toBeNull();
    expect(prisma.workspace.create).not.toHaveBeenCalled();
  });

  it('provisions the org its OWN workspace, never the bootstrap tenant', async () => {
    const prisma = fakePrisma();
    const svc = make(ENV_ON, prisma);

    const wsId = await svc.ensureEntitledWorkspace(customer, CUSTOMER_ORG, 'ADMIN');

    expect(wsId).toBe(CUSTOMER_ORG);
    expect(wsId).not.toBe(BOOTSTRAP);
    expect(prisma._workspaces).toHaveLength(1);
    expect(prisma._workspaces[0].id).toBe(CUSTOMER_ORG);

    // The owner is an ACTIVE OWNER of their own workspace, and it is their default.
    expect(prisma._memberships).toHaveLength(1);
    expect(prisma._memberships[0]).toMatchObject({
      userKey: 'kc-customer-sub',
      workspaceId: CUSTOMER_ORG,
      role: WorkspaceRole.OWNER,
      status: MembershipStatus.ACTIVE,
      isDefault: true,
    });
    // Nothing was written into the operator's tenant.
    expect(
      prisma._memberships.some((m: any) => m.workspaceId === BOOTSTRAP),
    ).toBe(false);
  });

  it('is idempotent: a second login does not mint a second workspace', async () => {
    const prisma = fakePrisma();
    const svc = make(ENV_ON, prisma);

    const first = await svc.ensureEntitledWorkspace(customer, CUSTOMER_ORG, 'ADMIN');
    const second = await svc.ensureEntitledWorkspace(customer, CUSTOMER_ORG, 'ADMIN');

    expect(second).toBe(first);
    expect(prisma._workspaces).toHaveLength(1);
    expect(prisma._memberships).toHaveLength(1);
  });

  it('puts a second user of the same org in the SAME workspace, at a lower role', async () => {
    const prisma = fakePrisma();
    const svc = make(ENV_ON, prisma);

    const ownerWs = await svc.ensureEntitledWorkspace(customer, CUSTOMER_ORG, 'ADMIN');
    const staffWs = await svc.ensureEntitledWorkspace(colleague, CUSTOMER_ORG, 'STAFF');

    expect(staffWs).toBe(ownerWs);
    expect(prisma._workspaces).toHaveLength(1);
    expect(prisma._memberships).toHaveLength(2);
    expect(
      prisma._memberships.find((m: any) => m.userKey === 'kc-colleague-sub').role,
    ).toBe(WorkspaceRole.MEMBER);
  });

  it('handles a non-UUID org id via a deterministic slug', async () => {
    const prisma = fakePrisma();
    const svc = make(ENV_ON, prisma);

    const a = await svc.ensureEntitledWorkspace(customer, 'Acme Corp!', 'ADMIN');
    const b = await svc.ensureEntitledWorkspace(colleague, 'Acme Corp!', 'STAFF');

    expect(a).toBe(b);
    expect(prisma._workspaces).toHaveLength(1);
    expect(prisma._workspaces[0].slug).toBe('org-acme-corp');
    expect(prisma._workspaces[0].id).not.toBe(BOOTSTRAP);
  });

  it('never creates a second workspace when the org id IS the bootstrap id', async () => {
    const prisma = fakePrisma();
    const svc = make(ENV_ON, prisma);

    const id = await svc.ensureEntitledWorkspace(customer, BOOTSTRAP, 'ADMIN');

    expect(id).toBe(BOOTSTRAP);
    expect(prisma.workspace.create).not.toHaveBeenCalled();
  });
});
