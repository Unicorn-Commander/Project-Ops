import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MembershipStatus, User, WorkspaceRole } from '@prisma/client';
import { WorkspacesService } from './workspaces.service';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../common/workspace/membership.service';
import { UcRegistryService } from '../common/registry/uc-registry.service';
import { AuditService } from '../audit/audit.service';

/**
 * WorkspacesService is the member-management control plane. The load-bearing
 * security guarantees pinned here:
 *   - VIEW (listMembers) requires an ACTIVE membership → non-member 403.
 *   - MANAGE (add/role/remove) requires the suite RANK (OWNER/ADMIN), checked
 *     against the TARGET workspace regardless of the tenancy flag.
 *   - The LAST active OWNER can never be demoted or removed.
 *   - add-existing-user creates an ACTIVE membership on their userKey; an
 *     unknown email creates a provisional `invite:<token>` membership + link.
 */
describe('WorkspacesService', () => {
  const WS = 'ws-1';

  const owner = { id: 'u-owner', email: 'owner@x.com', keycloakId: 'kc-owner' } as User;
  const admin = { id: 'u-admin', email: 'admin@x.com', keycloakId: 'kc-admin' } as User;
  const member = { id: 'u-member', email: 'member@x.com', keycloakId: 'kc-member' } as User;
  const stranger = { id: 'u-stranger', email: 'stranger@x.com', keycloakId: 'kc-stranger' } as User;

  function membershipRow(role: WorkspaceRole, userKey: string, status = MembershipStatus.ACTIVE) {
    return { userKey, workspaceId: WS, role, status, isDefault: false, createdAt: new Date() };
  }

  /**
   * Build a service with a mock Prisma. `membershipByKey` maps a userKey to the
   * row findUnique returns (the caller's membership + any target row).
   */
  function make(opts: {
    membershipByKey?: Record<string, any>;
    workspace?: any;
    ownerCount?: number;
    userByEmail?: Record<string, any>;
    prismaOverrides?: any;
  }) {
    const {
      membershipByKey = {},
      workspace = {
        id: WS,
        slug: 'ws',
        displayName: 'WS',
        isolationMode: 'standard',
        isolationTier: 'shared',
      },
      ownerCount = 1,
      userByEmail = {},
      prismaOverrides = {},
    } = opts;

    const prisma = {
      membership: {
        findUnique: jest.fn(({ where }: any) => {
          const key = where.userKey_workspaceId.userKey;
          return Promise.resolve(membershipByKey[key] ?? null);
        }),
        findMany: jest.fn().mockResolvedValue(Object.values(membershipByKey)),
        count: jest.fn().mockResolvedValue(ownerCount),
        upsert: jest.fn(({ create }: any) => Promise.resolve(create)),
        update: jest.fn(({ where, data }: any) =>
          Promise.resolve({ ...membershipByKey[where.userKey_workspaceId.userKey], ...data }),
        ),
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn(({ data }: any) => Promise.resolve(data)),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue(workspace),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(({ data }: any) => Promise.resolve(data)),
      },
      user: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve(userByEmail[where.email] ?? null)),
        // addMember matches users case-insensitively (findFirst + mode:
        // 'insensitive'); emulate that against the userByEmail keys.
        findFirst: jest.fn(({ where }: any) => {
          const wanted = String(where.email?.equals ?? '').toLowerCase();
          const hit = Object.entries(userByEmail).find(([k]) => k.toLowerCase() === wanted);
          return Promise.resolve(hit ? hit[1] : null);
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
      ...prismaOverrides,
    } as unknown as PrismaService;

    const config = {
      get: (k: string, def?: unknown) => def,
    } as unknown as ConfigService;

    const membershipService = new MembershipService(prisma, config);
    const registry = {
      registerWorkspace: jest
        .fn()
        .mockResolvedValue({ ok: true, skipped: true, reason: 'disabled' }),
    } as unknown as UcRegistryService;
    const audit = { log: jest.fn().mockResolvedValue(null) } as unknown as AuditService;

    const svc = new WorkspacesService(prisma, config, membershipService, registry, audit);
    return { svc, prisma, registry, audit };
  }

  describe('role rank', () => {
    it('orders viewer < member < manager < admin < owner', () => {
      expect(WorkspacesService.rank(WorkspaceRole.VIEWER)).toBeLessThan(
        WorkspacesService.rank(WorkspaceRole.MEMBER),
      );
      expect(WorkspacesService.rank(WorkspaceRole.MEMBER)).toBeLessThan(
        WorkspacesService.rank(WorkspaceRole.MANAGER),
      );
      expect(WorkspacesService.rank(WorkspaceRole.MANAGER)).toBeLessThan(
        WorkspacesService.rank(WorkspaceRole.ADMIN),
      );
      expect(WorkspacesService.rank(WorkspaceRole.ADMIN)).toBeLessThan(
        WorkspacesService.rank(WorkspaceRole.OWNER),
      );
    });
  });

  describe('create', () => {
    it('mints an id, derives a slug, makes the creator OWNER, registers with the registry', async () => {
      const { svc, prisma, registry } = make({});
      const result = await svc.create(owner, '  Acme Consulting  ');

      expect(result.role).toBe(WorkspaceRole.OWNER);
      expect(result.displayName).toBe('Acme Consulting');
      expect(result.slug).toBe('acme-consulting');
      expect(result.workspaceId).toMatch(/^[0-9a-f-]{36}$/);

      // Created workspace + owner membership in a transaction.
      expect((prisma.workspace as any).create).toHaveBeenCalled();
      const membershipCreate = (prisma.membership as any).create.mock.calls[0][0].data;
      expect(membershipCreate.role).toBe(WorkspaceRole.OWNER);
      expect(membershipCreate.userKey).toBe('kc-owner');
      expect(membershipCreate.status).toBe(MembershipStatus.ACTIVE);

      // Registry called (no-op shape here).
      expect(registry.registerWorkspace).toHaveBeenCalledTimes(1);
    });

    it('rejects a blank name', async () => {
      const { svc } = make({});
      await expect(svc.create(owner, '   ')).rejects.toThrow(BadRequestException);
    });
  });

  describe('listMembers (view authz)', () => {
    it('403s a non-member', async () => {
      const { svc } = make({
        membershipByKey: { 'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner') },
      });
      await expect(svc.listMembers(stranger, WS)).rejects.toThrow(ForbiddenException);
    });

    it('404s when the workspace does not exist', async () => {
      const { svc } = make({ workspace: null });
      await expect(svc.listMembers(owner, WS)).rejects.toThrow(NotFoundException);
    });

    it('lists members + flags pending invites for a member', async () => {
      const { svc, prisma } = make({
        membershipByKey: {
          'kc-member': membershipRow(WorkspaceRole.MEMBER, 'kc-member'),
          'invite:abc': membershipRow(WorkspaceRole.VIEWER, 'invite:abc'),
        },
      });
      (prisma.user as any).findMany.mockResolvedValue([
        {
          id: 'u-member',
          keycloakId: 'kc-member',
          email: 'member@x.com',
          firstName: 'Mem',
          lastName: 'Ber',
        },
      ]);

      const rows = await svc.listMembers(member, WS);
      const real = rows.find((r) => r.userKey === 'kc-member');
      const invite = rows.find((r) => r.userKey === 'invite:abc');
      expect(real?.pending).toBe(false);
      expect(real?.user?.name).toBe('Mem Ber');
      expect(invite?.pending).toBe(true);
      expect(invite?.user).toBeNull();
    });
  });

  describe('addMember (manage authz + invite mechanism)', () => {
    it('403s a non-owner/non-admin (a MEMBER)', async () => {
      const { svc } = make({
        membershipByKey: { 'kc-member': membershipRow(WorkspaceRole.MEMBER, 'kc-member') },
      });
      await expect(
        svc.addMember(member, WS, { email: 'new@x.com', role: WorkspaceRole.MEMBER }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets an ADMIN add an EXISTING user → creates an ACTIVE membership on their keycloakId', async () => {
      const { svc, prisma } = make({
        membershipByKey: { 'kc-admin': membershipRow(WorkspaceRole.ADMIN, 'kc-admin') },
        userByEmail: {
          'new@x.com': { id: 'u-new', email: 'new@x.com', keycloakId: 'kc-new' },
        },
      });

      const result = await svc.addMember(admin, WS, {
        email: 'New@X.com',
        role: WorkspaceRole.MEMBER,
      });
      expect(result.kind).toBe('member');
      expect(result.invited).toBe(false);
      const upsertArg = (prisma.membership as any).upsert.mock.calls[0][0];
      expect(upsertArg.where.userKey_workspaceId.userKey).toBe('kc-new');
      expect(upsertArg.create.status).toBe(MembershipStatus.ACTIVE);
      expect(upsertArg.create.role).toBe(WorkspaceRole.MEMBER);
    });

    it('creates a PENDING invite (+link) when the email has no user yet', async () => {
      const { svc, prisma } = make({
        membershipByKey: { 'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner') },
        userByEmail: {},
      });

      const result = await svc.addMember(owner, WS, {
        email: 'ghost@x.com',
        role: WorkspaceRole.VIEWER,
      });
      expect(result.kind).toBe('invite');
      expect(result.invited).toBe(true);
      expect(result.inviteToken).toMatch(/^[0-9a-f]{32}$/);
      expect(result.inviteUrl).toContain(`/auth/contact-signup/${result.inviteToken}`);
      const upsertArg = (prisma.membership as any).upsert.mock.calls[0][0];
      expect(upsertArg.create.userKey).toBe(`invite:${result.inviteToken}`);
    });

    it('refuses to grant OWNER via the share path', async () => {
      const { svc } = make({
        membershipByKey: { 'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner') },
      });
      await expect(
        svc.addMember(owner, WS, { email: 'new@x.com', role: WorkspaceRole.OWNER }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateMemberRole (OWNER only + last-owner)', () => {
    it('403s an ADMIN (manage-role is OWNER-only)', async () => {
      const { svc } = make({
        membershipByKey: {
          'kc-admin': membershipRow(WorkspaceRole.ADMIN, 'kc-admin'),
          'kc-member': membershipRow(WorkspaceRole.MEMBER, 'kc-member'),
        },
      });
      await expect(
        svc.updateMemberRole(admin, WS, 'kc-member', WorkspaceRole.MANAGER),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks demoting the LAST owner', async () => {
      const { svc } = make({
        membershipByKey: { 'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner') },
        ownerCount: 1,
      });
      await expect(
        svc.updateMemberRole(owner, WS, 'kc-owner', WorkspaceRole.MEMBER),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows demoting an owner when another owner remains', async () => {
      const { svc, prisma } = make({
        membershipByKey: {
          'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner'),
          'kc-owner2': membershipRow(WorkspaceRole.OWNER, 'kc-owner2'),
        },
        ownerCount: 2,
      });
      const res = await svc.updateMemberRole(owner, WS, 'kc-owner2', WorkspaceRole.MANAGER);
      expect(res.role).toBe(WorkspaceRole.MANAGER);
      expect((prisma.membership as any).update).toHaveBeenCalled();
    });

    it('promotes a member to OWNER (co-owner)', async () => {
      const { svc } = make({
        membershipByKey: {
          'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner'),
          'kc-member': membershipRow(WorkspaceRole.MEMBER, 'kc-member'),
        },
      });
      const res = await svc.updateMemberRole(owner, WS, 'kc-member', WorkspaceRole.OWNER);
      expect(res.role).toBe(WorkspaceRole.OWNER);
    });

    it('404s an unknown target member', async () => {
      const { svc } = make({
        membershipByKey: { 'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner') },
      });
      await expect(
        svc.updateMemberRole(owner, WS, 'kc-nobody', WorkspaceRole.MEMBER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('removeMember (OWNER only + last-owner)', () => {
    it('403s a non-owner', async () => {
      const { svc } = make({
        membershipByKey: {
          'kc-admin': membershipRow(WorkspaceRole.ADMIN, 'kc-admin'),
          'kc-member': membershipRow(WorkspaceRole.MEMBER, 'kc-member'),
        },
      });
      await expect(svc.removeMember(admin, WS, 'kc-member')).rejects.toThrow(ForbiddenException);
    });

    it('blocks removing the LAST owner', async () => {
      const { svc } = make({
        membershipByKey: { 'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner') },
        ownerCount: 1,
      });
      await expect(svc.removeMember(owner, WS, 'kc-owner')).rejects.toThrow(BadRequestException);
    });

    it('removes a regular member', async () => {
      const { svc, prisma } = make({
        membershipByKey: {
          'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner'),
          'kc-member': membershipRow(WorkspaceRole.MEMBER, 'kc-member'),
        },
      });
      const res = await svc.removeMember(owner, WS, 'kc-member');
      expect(res.removed).toBe(true);
      expect((prisma.membership as any).delete).toHaveBeenCalled();
    });

    it('removes a pending invite', async () => {
      const { svc, prisma } = make({
        membershipByKey: {
          'kc-owner': membershipRow(WorkspaceRole.OWNER, 'kc-owner'),
          'invite:tok': membershipRow(WorkspaceRole.VIEWER, 'invite:tok'),
        },
      });
      const res = await svc.removeMember(owner, WS, 'invite:tok');
      expect(res.removed).toBe(true);
      expect((prisma.membership as any).delete).toHaveBeenCalled();
    });
  });
});
