import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembershipStatus, User, WorkspaceRole } from '@prisma/client';
import { MembershipService } from './membership.service';
import { PrismaService } from '../../prisma/prisma.service';
import { __resetAccessListCacheForTests } from '../../auth/access-list';

const ORIGINAL_ACCESS_LIST = process.env.PROJECT_OPS_ACCESS_LIST;

const BOOTSTRAP = '0190a000-7e57-7000-8000-00000000b007';

/**
 * MembershipService is the workspace-access gate (SUITE-IDENTITY §D5). The
 * load-bearing guarantees pinned here:
 *   - Flag OFF (default) => total no-op: resolves to default, never throws,
 *     never touches membership. (Rollout-safety: nothing breaks today.)
 *   - Flag ON => membership gates: 403 without a membership; allow-listed
 *     users are seeded JIT into the bootstrap workspace; requested workspace
 *     must be one the user belongs to.
 */
describe('MembershipService', () => {
  const owner = {
    id: 'local-owner',
    email: 'owner@example.com',
    keycloakId: 'kc-owner-sub',
  } as User;

  const stranger = {
    id: 'local-stranger',
    email: 'stranger@example.net',
    keycloakId: 'kc-stranger-sub',
  } as User;

  function make(env: Record<string, string | undefined>, prismaMock: any) {
    const config = {
      get: (k: string, def?: unknown) => (k in env ? env[k] : def),
    } as unknown as ConfigService;
    return new MembershipService(prismaMock as PrismaService, config);
  }

  beforeEach(() => {
    __resetAccessListCacheForTests();
    process.env.PROJECT_OPS_ACCESS_LIST = 'owner@example.com:ADMIN';
  });

  afterEach(() => {
    if (ORIGINAL_ACCESS_LIST === undefined) delete process.env.PROJECT_OPS_ACCESS_LIST;
    else process.env.PROJECT_OPS_ACCESS_LIST = ORIGINAL_ACCESS_LIST;
    __resetAccessListCacheForTests();
  });

  describe('flag OFF (default)', () => {
    const prisma = { membership: {}, workspace: {} };

    it('resolveAndAuthorize returns the requested workspace without a membership check', async () => {
      const svc = make({ DEFAULT_WORKSPACE_ID: BOOTSTRAP }, prisma);
      await expect(svc.resolveAndAuthorize(owner, 'W-requested')).resolves.toBe('W-requested');
    });

    it('resolveAndAuthorize falls back to the default workspace when none requested', async () => {
      const svc = make({ DEFAULT_WORKSPACE_ID: BOOTSTRAP }, prisma);
      await expect(svc.resolveAndAuthorize(owner, null)).resolves.toBe(BOOTSTRAP);
    });

    it('never throws for a non-allow-listed user when the flag is off', async () => {
      const svc = make({ DEFAULT_WORKSPACE_ID: BOOTSTRAP }, prisma);
      await expect(svc.resolveAndAuthorize(stranger, null)).resolves.toBe(BOOTSTRAP);
    });
  });

  describe('flag ON', () => {
    const ON = { PROJECT_OPS_TENANCY_ENABLED: 'true', DEFAULT_WORKSPACE_ID: BOOTSTRAP };

    it('403s a user with no active membership (non-allow-listed, no seed)', async () => {
      const prisma = {
        membership: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ id: BOOTSTRAP }) },
      };
      const svc = make(ON, prisma);
      await expect(svc.resolveAndAuthorize(stranger, null)).rejects.toThrow(ForbiddenException);
      // stranger is not allow-listed, so no membership is created.
      expect(prisma.membership.findMany).toHaveBeenCalled();
    });

    it('does not bootstrap an owner when the access list is missing', async () => {
      delete process.env.PROJECT_OPS_ACCESS_LIST;
      const prisma = {
        membership: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
          upsert: jest.fn(),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ id: BOOTSTRAP }) },
      };
      await expect(make(ON, prisma).resolveAndAuthorize(owner, null)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.membership.upsert).not.toHaveBeenCalled();
    });

    it('seeds an allow-listed user JIT, then resolves their default workspace', async () => {
      const created = {
        userKey: 'kc-owner-sub',
        workspaceId: BOOTSTRAP,
        role: WorkspaceRole.OWNER,
        status: MembershipStatus.ACTIVE,
        isDefault: true,
      };
      const prisma = {
        membership: {
          findFirst: jest.fn().mockResolvedValue(null), // no existing membership -> seed path
          upsert: jest.fn().mockResolvedValue(created),
          // after seeding, listActiveMemberships returns the seeded row
          findMany: jest.fn().mockResolvedValue([created]),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ id: BOOTSTRAP }) },
      };
      const svc = make(ON, prisma);
      await expect(svc.resolveAndAuthorize(owner, null)).resolves.toBe(BOOTSTRAP);
      expect(prisma.membership.upsert).toHaveBeenCalledTimes(1);
      const arg = prisma.membership.upsert.mock.calls[0][0];
      expect(arg.create.role).toBe(WorkspaceRole.OWNER); // ADMIN -> OWNER
      expect(arg.create.userKey).toBe('kc-owner-sub'); // keyed by keycloakId/sub
    });

    it('403s when the requested workspace is not one the user belongs to', async () => {
      const member = {
        userKey: 'kc-owner-sub',
        workspaceId: BOOTSTRAP,
        status: MembershipStatus.ACTIVE,
        isDefault: true,
      };
      const prisma = {
        membership: {
          findFirst: jest.fn().mockResolvedValue(member), // already has membership, skip seed
          findMany: jest.fn().mockResolvedValue([member]),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ id: BOOTSTRAP }) },
      };
      const svc = make(ON, prisma);
      await expect(svc.resolveAndAuthorize(owner, 'SOME-OTHER-WS')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows the requested workspace when the user is a member of it', async () => {
      const member = {
        userKey: 'kc-owner-sub',
        workspaceId: BOOTSTRAP,
        status: MembershipStatus.ACTIVE,
        isDefault: true,
      };
      const prisma = {
        membership: {
          findFirst: jest.fn().mockResolvedValue(member),
          findMany: jest.fn().mockResolvedValue([member]),
        },
        workspace: { findUnique: jest.fn().mockResolvedValue({ id: BOOTSTRAP }) },
      };
      const svc = make(ON, prisma);
      await expect(svc.resolveAndAuthorize(owner, BOOTSTRAP)).resolves.toBe(BOOTSTRAP);
    });
  });

  describe('listActiveWorkspaces (switcher shape — C2)', () => {
    it('joins memberships to workspace identity in the canonical shape, default-first', async () => {
      // listActiveMemberships already orders isDefault desc, createdAt asc.
      const memberships = [
        {
          userKey: 'kc-owner-sub',
          workspaceId: 'ws-mu',
          role: WorkspaceRole.OWNER,
          status: MembershipStatus.ACTIVE,
          isDefault: true,
        },
        {
          userKey: 'kc-owner-sub',
          workspaceId: 'ws-gfl',
          role: WorkspaceRole.MANAGER,
          status: MembershipStatus.ACTIVE,
          isDefault: false,
        },
      ];
      const findMany = jest.fn().mockImplementation((args: any) =>
        args?.where?.id // workspace.findMany batch lookup
          ? Promise.resolve([
              { id: 'ws-gfl', slug: 'brightwater-labs', displayName: 'Brightwater Labs' },
              { id: 'ws-mu', slug: 'magic-unicorn', displayName: 'Magic Unicorn' },
            ])
          : Promise.resolve(memberships),
      );
      const prisma = {
        membership: { findMany },
        workspace: { findMany },
      };
      const svc = make({ DEFAULT_WORKSPACE_ID: BOOTSTRAP }, prisma);
      const result = await svc.listActiveWorkspaces(owner);
      expect(result).toEqual([
        {
          workspaceId: 'ws-mu',
          slug: 'magic-unicorn',
          displayName: 'Magic Unicorn',
          role: WorkspaceRole.OWNER,
          isDefault: true,
        },
        {
          workspaceId: 'ws-gfl',
          slug: 'brightwater-labs',
          displayName: 'Brightwater Labs',
          role: WorkspaceRole.MANAGER,
          isDefault: false,
        },
      ]);
    });

    it('returns [] when the user has no active memberships (tenancy-off default)', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = { membership: { findMany }, workspace: { findMany: jest.fn() } };
      const svc = make({ DEFAULT_WORKSPACE_ID: BOOTSTRAP }, prisma);
      await expect(svc.listActiveWorkspaces(owner)).resolves.toEqual([]);
      // no membership rows => never queries workspaces.
      expect(prisma.workspace.findMany).not.toHaveBeenCalled();
    });

    it('drops a membership whose workspace row is not present locally (cannot render a switcher entry)', async () => {
      const membershipFindMany = jest.fn().mockResolvedValue([
        {
          userKey: 'kc-owner-sub',
          workspaceId: 'ws-present',
          role: WorkspaceRole.MEMBER,
          status: MembershipStatus.ACTIVE,
          isDefault: false,
        },
        {
          userKey: 'kc-owner-sub',
          workspaceId: 'ws-orphan',
          role: WorkspaceRole.MEMBER,
          status: MembershipStatus.ACTIVE,
          isDefault: false,
        },
      ]);
      const workspaceFindMany = jest
        .fn()
        .mockResolvedValue([{ id: 'ws-present', slug: 'present', displayName: 'Present WS' }]);
      const prisma = {
        membership: { findMany: membershipFindMany },
        workspace: { findMany: workspaceFindMany },
      };
      const svc = make({ DEFAULT_WORKSPACE_ID: BOOTSTRAP }, prisma);
      const result = await svc.listActiveWorkspaces(owner);
      expect(result).toEqual([
        {
          workspaceId: 'ws-present',
          slug: 'present',
          displayName: 'Present WS',
          role: WorkspaceRole.MEMBER,
          isDefault: false,
        },
      ]);
    });
  });

  describe('membershipKey + role mapping', () => {
    it('keys by keycloakId (uchub sub) when present, else local id', () => {
      expect(MembershipService.membershipKey({ id: 'L', keycloakId: 'kc' } as User)).toBe('kc');
      expect(MembershipService.membershipKey({ id: 'L', keycloakId: null } as User)).toBe('L');
    });

    it('maps app roles to canonical suite WorkspaceRoles (SUITE-IDENTITY §7)', () => {
      expect(MembershipService.suiteRoleForAccess('ADMIN')).toBe(WorkspaceRole.OWNER);
      expect(MembershipService.suiteRoleForAccess('MANAGER')).toBe(WorkspaceRole.MANAGER);
      expect(MembershipService.suiteRoleForAccess('STAFF')).toBe(WorkspaceRole.MEMBER);
      expect(MembershipService.suiteRoleForAccess('CLIENT')).toBe(WorkspaceRole.VIEWER);
    });

    it('returns an active workspace role using the canonical membership key', async () => {
      const findUnique = jest.fn().mockResolvedValue({
        role: WorkspaceRole.MANAGER,
        status: MembershipStatus.ACTIVE,
      });
      const svc = make({}, { membership: { findUnique } });

      await expect(svc.getActiveMembershipRole(aaron, 'ws-1')).resolves.toBe(WorkspaceRole.MANAGER);
      expect(findUnique).toHaveBeenCalledWith({
        where: { userKey_workspaceId: { userKey: 'kc-aaron-sub', workspaceId: 'ws-1' } },
        select: { role: true, status: true },
      });
    });

    it('returns null for an inactive workspace membership', async () => {
      const svc = make(
        {},
        {
          membership: {
            findUnique: jest.fn().mockResolvedValue({
              role: WorkspaceRole.MEMBER,
              status: MembershipStatus.SUSPENDED,
            }),
          },
        },
      );

      await expect(svc.getActiveMembershipRole(aaron, 'ws-1')).resolves.toBeNull();
    });
  });
});
