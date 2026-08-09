import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Membership, MembershipStatus, User, WorkspaceRole } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveUserAccess } from '../../auth/access-list';
import { tenancyEnabled } from './feature-flags';
import { DEFAULT_WORKSPACE_FALLBACK } from './workspace.util';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return this.config.get<string>(
      'DEFAULT_WORKSPACE_ID',
      DEFAULT_WORKSPACE_FALLBACK,
    );
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
  async resolveAndAuthorize(
    user: User,
    requestedWorkspaceId?: string | null,
  ): Promise<string> {
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
        this.logger.warn(
          `403 workspace access for ${user.email}: not a member of ${target}`,
        );
        throw new ForbiddenException('Not a member of the requested workspace.');
      }
      return target;
    }

    // No explicit target: the default membership, else the first.
    const def = memberships.find((m) => m.isDefault) ?? memberships[0];
    return def.workspaceId;
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
   * Provision (idempotently) the workspace that belongs to an ENTITLED customer
   * org, and make `user` an active member of it.
   *
   * This is the self-serve onboarding path. Previously the ONLY way to get a
   * membership was `ensureSeededMembership`, which seeds from the static
   * PROJECT_OPS_ACCESS_LIST into the BOOTSTRAP workspace. That meant a paying
   * Suite customer — Project-Ops is advertised in both paid tiers — could pass
   * the entitlements gate, authenticate, and then be 403'd on every workspace
   * route because no membership existed. Onboarding required a human editing
   * the container env and restarting.
   *
   * It also means the bootstrap workspace is the WRONG destination for a new
   * customer: seeding them there would drop them into Magic Unicorn's own
   * tenant. Each org gets its own workspace instead.
   *
   * Idempotency is keyed on the Ops-Center `org_id`, so every user from the
   * same org lands in the SAME workspace:
   *   - org_id that is already a UUID  -> used directly as the workspace id,
   *     matching the "Workspace.id == uc-registry workspace_id" contract.
   *   - anything else -> a stable `org-<sanitized>` slug is the lookup key and
   *     the id is minted locally.
   *
   * Returns the workspace id, or null when it cannot provision (no org id, or
   * tenancy disabled) so the caller can fall back to existing behavior.
   */
  async ensureEntitledWorkspace(
    user: User,
    orgId: string | null | undefined,
    appRole: string,
    displayNameHint?: string | null,
  ): Promise<string | null> {
    if (!this.enabled) return null;
    const org = orgId?.trim();
    if (!org) return null;

    // NEVER route an entitled customer into the operator's bootstrap tenant.
    if (org === this.bootstrapWorkspaceId) {
      return this.bootstrapWorkspaceId;
    }

    const userKey = MembershipService.membershipKey(user);
    const isUuid = UUID_RE.test(org);
    const slug = isUuid ? `org-${org.slice(0, 8)}` : `org-${org.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tenant'}`;
    const displayName = displayNameHint?.trim() || `Organization ${org.slice(0, 8)}`;
    const role = MembershipService.suiteRoleForAccess(appRole);

    // Find an existing workspace for this org: by id when the org id IS the
    // workspace id, else by the deterministic slug.
    let workspace = isUuid
      ? await this.prisma.workspace.findUnique({ where: { id: org } })
      : await this.prisma.workspace.findUnique({ where: { slug } });

    if (!workspace) {
      const id = isUuid ? org : uuidv4();
      try {
        workspace = await this.prisma.workspace.create({
          data: { id, slug, displayName },
        });
        this.logger.log(
          `Provisioned workspace ${workspace.id} (${slug}) for entitled org ${org}`,
        );
      } catch (err) {
        // Concurrent first-login from two users of the same org: one create
        // wins, the other re-reads rather than failing the login.
        workspace = isUuid
          ? await this.prisma.workspace.findUnique({ where: { id: org } })
          : await this.prisma.workspace.findUnique({ where: { slug } });
        if (!workspace) {
          this.logger.error(
            `Failed to provision workspace for org ${org}: ${(err as Error).message}`,
          );
          return null;
        }
      }
    }

    // The user's FIRST workspace becomes their default; a user who already
    // belongs somewhere keeps their existing default.
    const hasAny = await this.prisma.membership.findFirst({ where: { userKey } });
    await this.prisma.membership.upsert({
      where: { userKey_workspaceId: { userKey, workspaceId: workspace.id } },
      update: { status: MembershipStatus.ACTIVE },
      create: {
        userKey,
        workspaceId: workspace.id,
        role,
        status: MembershipStatus.ACTIVE,
        isDefault: !hasAny,
      },
    });

    this.logger.log(
      `Entitled membership ensured: ${user.email} -> workspace ${workspace.id} as ${role}`,
    );
    return workspace.id;
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
