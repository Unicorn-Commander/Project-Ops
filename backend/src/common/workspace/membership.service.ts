import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Membership, MembershipStatus, User, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveUserAccess } from '../../auth/access-list';
import { tenancyEnabled } from './feature-flags';
import { DEFAULT_WORKSPACE_FALLBACK } from './workspace.util';

/**
 * A single switcher-ready entry describing one workspace the caller actively
 * belongs to. This is the canonical shape the frontend workspace switcher
 * (Phase C3, mirroring Meeting-Ops' OrgContext) consumes: it joins the
 * membership (role / isDefault) with the workspace identity (slug /
 * displayName). It is returned ONLY in JSON response bodies (login / profile)
 * — never embedded in the JWT.
 */
export interface ActiveWorkspaceMembership {
  workspaceId: string;
  slug: string;
  displayName: string;
  role: WorkspaceRole;
  isDefault: boolean;
}

/**
 * Workspace membership resolution + gating (SUITE-IDENTITY §3, §D5).
 *
 * The cross-app contract: a valid uchub token JIT-provisions the User row, but
 * grants ZERO workspace access until an explicit Membership row exists. The
 * allow-list (PROJECT_OPS_ACCESS_LIST) is a membership-SEEDING convenience —
 * NOT "the tenant". Membership is what gates.
 *
 * Rollout-safety: every gate here is a no-op while PROJECT_OPS_TENANCY_ENABLED
 * is off (its default). With the flag off, callers fall back to
 * DEFAULT_WORKSPACE_ID exactly as before this change. With the flag on,
 * workspace routes 403 without an active membership and the membership-derived
 * workspace drives the RLS GUC.
 */
@Injectable()
export class MembershipService {
  private readonly logger = new Logger(MembershipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get enabled(): boolean {
    return tenancyEnabled((k) => this.config.get<string>(k));
  }

  /** The single bootstrap/dogfood workspace id seeded by the RLS migration. */
  get bootstrapWorkspaceId(): string {
    return this.config.get<string>('DEFAULT_WORKSPACE_ID', DEFAULT_WORKSPACE_FALLBACK);
  }

  /**
   * The membership key for a user == uchub `sub` == User.keycloakId. Local
   * (non-SSO) users have no keycloakId; their membership key falls back to the
   * local user id so the dogfood seed still resolves.
   */
  static membershipKey(user: Pick<User, 'id' | 'keycloakId'>): string {
    return user.keycloakId ?? user.id;
  }

  /** All ACTIVE memberships for a user (keyed by sub/keycloakId or local id). */
  async listActiveMemberships(user: Pick<User, 'id' | 'keycloakId'>): Promise<Membership[]> {
    const userKey = MembershipService.membershipKey(user);
    return this.prisma.membership.findMany({
      where: { userKey, status: MembershipStatus.ACTIVE },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * The caller's ACTIVE memberships, enriched with workspace identity for the
   * frontend switcher: `{ workspaceId, slug, displayName, role, isDefault }`.
   *
   * Built on top of `listActiveMemberships` (which already applies the
   * default-first ordering), then joined to the local Workspace rows in a
   * single batch query (no N+1). A membership whose Workspace row is not
   * present locally is dropped — without a slug/displayName it cannot be
   * rendered as a switcher entry, and surfacing a half-populated entry would
   * break the switcher's slug-keyed lookup. The default-first ordering from
   * `listActiveMemberships` is preserved.
   */
  async listActiveWorkspaces(
    user: Pick<User, 'id' | 'keycloakId'>,
  ): Promise<ActiveWorkspaceMembership[]> {
    const memberships = await this.listActiveMemberships(user);
    if (memberships.length === 0) return [];

    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: memberships.map((m) => m.workspaceId) } },
      select: { id: true, slug: true, displayName: true },
    });
    const byId = new Map(workspaces.map((w) => [w.id, w]));

    const result: ActiveWorkspaceMembership[] = [];
    for (const m of memberships) {
      const ws = byId.get(m.workspaceId);
      if (!ws) {
        this.logger.warn(
          `Skipping switcher entry for ${MembershipService.membershipKey(user)}: workspace ${m.workspaceId} not present locally`,
        );
        continue;
      }
      result.push({
        workspaceId: m.workspaceId,
        slug: ws.slug,
        displayName: ws.displayName,
        role: m.role,
        isDefault: m.isDefault,
      });
    }
    return result;
  }

  /** True iff the user has an ACTIVE membership in `workspaceId`. */
  async isActiveMember(
    user: Pick<User, 'id' | 'keycloakId'>,
    workspaceId: string,
  ): Promise<boolean> {
    const userKey = MembershipService.membershipKey(user);
    const m = await this.prisma.membership.findUnique({
      where: { userKey_workspaceId: { userKey, workspaceId } },
    });
    return !!m && m.status === MembershipStatus.ACTIVE;
  }

  /**
   * Resolve the workspace a request should run in for `user`, and ensure the
   * user is an active member of it.
   *
   *  - Flag OFF (default): returns the requested/default workspace WITHOUT a
   *    membership check (today's single-tenant behavior, never throws).
   *  - Flag ON: the user must have an active membership; an allow-listed user
   *    with no membership is seeded JIT into the bootstrap workspace; anyone
   *    else gets a 403. The requested workspace (path/header/claim) must be one
   *    the user actually belongs to, else 403.
   *
   * @param requestedWorkspaceId optional explicit target (from path/header/claim).
   */
  async resolveAndAuthorize(user: User, requestedWorkspaceId?: string | null): Promise<string> {
    const fallback = this.bootstrapWorkspaceId;

    if (!this.enabled) {
      // Inert: behave exactly as before — claim/requested wins, else default.
      return requestedWorkspaceId?.trim() || fallback;
    }

    // Tenancy live: membership gates. Seed allow-listed users JIT.
    await this.ensureSeededMembership(user);

    const memberships = await this.listActiveMemberships(user);
    if (memberships.length === 0) {
      this.logger.warn(
        `403 workspace access for ${user.email} (${MembershipService.membershipKey(user)}): no active membership`,
      );
      throw new ForbiddenException('No workspace access for this user.');
    }

    if (requestedWorkspaceId?.trim()) {
      const target = requestedWorkspaceId.trim();
      if (!memberships.some((m) => m.workspaceId === target)) {
        this.logger.warn(`403 workspace access for ${user.email}: not a member of ${target}`);
        throw new ForbiddenException('Not a member of the requested workspace.');
      }
      return target;
    }

    // No explicit target: the default membership, else the first.
    const def = memberships.find((m) => m.isDefault) ?? memberships[0];
    return def.workspaceId;
  }

  /** Fresh workspace management authority; never promotes the app-wide user role. */
  async hasManagementRole(user: User, workspaceId: string): Promise<boolean> {
    if (!this.enabled) return false;
    const member = await this.prisma.membership.findUnique({
      where: {
        userKey_workspaceId: { userKey: MembershipService.membershipKey(user), workspaceId },
      },
      include: { workspace: { select: { status: true } } },
    });
    return (
      member?.status === MembershipStatus.ACTIVE &&
      member.workspace.status === 'active' &&
      (
        [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.MANAGER] as WorkspaceRole[]
      ).includes(member.role)
    );
  }

  /** Re-read authority for every write, including calls on an existing MCP server. */
  async assertCanWrite(user: User, workspaceId: string): Promise<void> {
    if (!this.enabled) return;
    const member = await this.prisma.membership.findUnique({
      where: {
        userKey_workspaceId: { userKey: MembershipService.membershipKey(user), workspaceId },
      },
      include: { workspace: { select: { status: true } } },
    });
    if (
      !member ||
      member.status !== MembershipStatus.ACTIVE ||
      member.workspace.status !== 'active' ||
      ![
        WorkspaceRole.MEMBER,
        WorkspaceRole.MANAGER,
        WorkspaceRole.ADMIN,
        WorkspaceRole.OWNER,
      ].includes(member.role as any)
    ) {
      throw new ForbiddenException(
        'An active MEMBER or higher workspace role is required for this operation.',
      );
    }
  }

  /**
   * If `user` is on the SSO allow-list but has no membership yet, seed one into
   * the bootstrap workspace at the role mapped from their access-list role.
   * Idempotent. Only runs when tenancy is enabled.
   */
  async ensureSeededMembership(user: User): Promise<void> {
    if (!this.enabled) return;
    const userKey = MembershipService.membershipKey(user);

    const existing = await this.prisma.membership.findFirst({ where: { userKey } });
    if (existing) return;

    const access = resolveUserAccess(user.email);
    if (!access.allowed) return; // not allow-listed -> no seed; gate will 403.

    const workspaceId = this.bootstrapWorkspaceId;
    // Only seed if the bootstrap workspace actually exists locally.
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws) {
      this.logger.warn(
        `Cannot seed membership for ${user.email}: bootstrap workspace ${workspaceId} not present`,
      );
      return;
    }

    const role = MembershipService.suiteRoleForAccess(access.role);
    await this.prisma.membership.upsert({
      where: { userKey_workspaceId: { userKey, workspaceId } },
      update: {},
      create: {
        userKey,
        workspaceId,
        role,
        status: MembershipStatus.ACTIVE,
        isDefault: true,
      },
    });
    this.logger.log(
      `Seeded ${role} membership for ${user.email} in workspace ${workspaceId} (allow-list)`,
    );
  }

  /**
   * Map a PO app UserRole-string (from the access list) to the canonical suite
   * WorkspaceRole (SUITE-IDENTITY §7). ADMIN/owner-ish operators become OWNER
   * of their bootstrap workspace; everyone else maps conservatively.
   */
  static suiteRoleForAccess(appRole: string): WorkspaceRole {
    switch (appRole) {
      case 'ADMIN':
        return WorkspaceRole.OWNER;
      case 'MANAGER':
        return WorkspaceRole.MANAGER;
      case 'STAFF':
        return WorkspaceRole.MEMBER;
      case 'CLIENT':
      default:
        return WorkspaceRole.VIEWER;
    }
  }
}
