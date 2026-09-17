import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Membership, MembershipStatus, User, Workspace, WorkspaceRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../common/workspace/membership.service';
import { UcRegistryService } from '../common/registry/uc-registry.service';
import { AuditService } from '../audit/audit.service';
import { AddMemberDto } from './dto/add-member.dto';

/**
 * Workspace & member management — the "easy sharing" control plane.
 *
 * WHY this lives off the RLS chokepoint: `workspaces` and `memberships` are the
 * two tenancy CONTROL tables, deliberately NOT under Row Level Security (see
 * 20260603051046_suite_tenancy_rls_roles §6a/§7 — they are granted to
 * project_ops_app but excluded from the FORCE-RLS `scoped_tables` set, and the
 * runtime app reads `invite:<token>` rows with no GUC in AuthService.clientSignup).
 * That is exactly right here: an OWNER manages members of a workspace that is
 * NOT necessarily their *active* GUC workspace, so we must read/write these rows
 * directly via `this.prisma` rather than forcing them through `withWorkspace`
 * (which would scope to the wrong workspace and is moot for non-RLS tables).
 *
 * AUTHORIZATION model. The global WorkspaceMembershipGuard, when tenancy is ON,
 * already 403s a non-member of `:workspaceId` (the path-param feeds D4
 * addressing precedence). But the guard only proves MEMBERSHIP, not the suite
 * RANK (viewer < member < manager < admin < owner, SUITE-IDENTITY §7), and the
 * `RolesGuard` only checks the local app UserRole. So every MANAGE operation
 * re-resolves the caller's ACTIVE membership in the TARGET workspace and gates
 * on its WorkspaceRole here, independent of the flag — making manage-authz
 * correct even while tenancy is OFF (when the guard is inert).
 */
@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly membership: MembershipService,
    private readonly registry: UcRegistryService,
    private readonly audit: AuditService,
  ) {}

  // Suite role ranking (SUITE-IDENTITY §7). Higher = more privilege.
  private static readonly ROLE_RANK: Record<WorkspaceRole, number> = {
    [WorkspaceRole.VIEWER]: 0,
    [WorkspaceRole.MEMBER]: 1,
    [WorkspaceRole.MANAGER]: 2,
    [WorkspaceRole.ADMIN]: 3,
    [WorkspaceRole.OWNER]: 4,
  };

  static rank(role: WorkspaceRole): number {
    return WorkspacesService.ROLE_RANK[role];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Authorization helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * The caller's ACTIVE membership in `workspaceId`, or null. Keyed by the same
   * userKey contract as the rest of the suite (keycloakId ?? local id).
   */
  private async activeMembershipOf(
    user: Pick<User, 'id' | 'keycloakId'>,
    workspaceId: string,
  ): Promise<Membership | null> {
    const userKey = MembershipService.membershipKey(user);
    const m = await this.prisma.membership.findUnique({
      where: { userKey_workspaceId: { userKey, workspaceId } },
    });
    return m && m.status === MembershipStatus.ACTIVE ? m : null;
  }

  /**
   * Resolve the workspace (404 if absent) and the caller's ACTIVE membership in
   * it (403 if not a member), then require at least `minRole` rank (403 if too
   * low). Returns both so callers don't re-query. This is the single manage
   * gate — view uses the membership-only variant below.
   */
  private async requireRole(
    user: User,
    workspaceId: string,
    minRole: WorkspaceRole,
  ): Promise<{ workspace: Workspace; membership: Membership }> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    const membership = await this.activeMembershipOf(user, workspaceId);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }
    if (WorkspacesService.rank(membership.role) < WorkspacesService.rank(minRole)) {
      throw new ForbiddenException(`This action requires ${minRole} or higher in this workspace`);
    }
    return { workspace, membership };
  }

  /** View gate: workspace must exist + caller must be an ACTIVE member. */
  private async requireMember(user: User, workspaceId: string): Promise<Workspace> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    const membership = await this.activeMembershipOf(user, workspaceId);
    if (!membership) {
      throw new ForbiddenException('You are not a member of this workspace');
    }
    return workspace;
  }

  /** Count of ACTIVE OWNER memberships in a workspace (last-owner guard). */
  private async activeOwnerCount(workspaceId: string): Promise<number> {
    return this.prisma.membership.count({
      where: {
        workspaceId,
        role: WorkspaceRole.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Create
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a workspace from a display name. Any authenticated user may create
   * one; they become its OWNER. The id is self-minted locally (uuid) — mirroring
   * the dogfood seed — and registered with uc-registry (a pure no-op unless
   * UC_REGISTRY_URL is set), so the registry and PO's local mirror agree on the
   * same id ("supplied = local"). Returns the new workspace in the switcher
   * shape so the frontend can add it without a round-trip.
   */
  async create(user: User, displayName: string) {
    const name = displayName.trim();
    if (!name) {
      throw new BadRequestException('Workspace name is required');
    }

    const id = uuidv4();
    const slug = await this.deriveUniqueSlug(name);
    const userKey = MembershipService.membershipKey(user);

    // workspaces + memberships are control-plane (no RLS); create both in one
    // local transaction so a half-created workspace (no owner membership) is
    // impossible. uc-registry registration is best-effort AFTER commit.
    const workspace = await this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          id,
          slug,
          displayName: name,
          // Defaults (isolationMode/Tier/status) come from the schema.
        },
      });
      await tx.membership.create({
        data: {
          userKey,
          workspaceId: ws.id,
          role: WorkspaceRole.OWNER,
          status: MembershipStatus.ACTIVE,
          // Not isDefault: creating a workspace shouldn't silently move the
          // user's default tenant out from under them. They can switch to it.
          isDefault: false,
        },
      });
      return ws;
    });

    // Phase E: register the canonical id with the suite SoR. No-op unless
    // UC_REGISTRY_URL is set; never throws (best-effort + loud) so a registry
    // outage can't roll back a local creation.
    const outcome = await this.registry.registerWorkspace({
      id: workspace.id,
      slug: workspace.slug,
      displayName: workspace.displayName,
      isolationMode: workspace.isolationMode,
      isolationTier: workspace.isolationTier,
    });
    if (!outcome.ok) {
      this.logger.warn(
        `uc-registry: ${outcome.message} (workspace ${workspace.id} created locally; SoR reconcile pending)`,
      );
    }

    await this.audit.log({
      workspaceId: workspace.id,
      userId: user.id,
      action: 'CREATE',
      resource: 'Workspace',
      resourceId: workspace.id,
      details: { displayName: workspace.displayName, slug: workspace.slug },
    });

    this.logger.log(
      `Workspace created: ${workspace.displayName} (${workspace.slug}) ${workspace.id} by ${user.email} as OWNER`,
    );

    // Switcher shape (matches ActiveWorkspaceMembership) so the FE can append it.
    return {
      workspaceId: workspace.id,
      slug: workspace.slug,
      displayName: workspace.displayName,
      role: WorkspaceRole.OWNER,
      isDefault: false,
    };
  }

  /**
   * Slugify a display name and ensure global uniqueness (the slug column is
   * UNIQUE). Falls back to numeric suffixes, then a short random suffix, so a
   * pathological name (all punctuation) still yields a valid unique slug.
   */
  private async deriveUniqueSlug(displayName: string): Promise<string> {
    const base =
      displayName
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'workspace';

    // Pull existing slugs that could collide in one query, then pick the first
    // free candidate locally (avoids a findUnique-per-attempt loop).
    const taken = new Set(
      (
        await this.prisma.workspace.findMany({
          where: { slug: { startsWith: base } },
          select: { slug: true },
        })
      ).map((w) => w.slug),
    );

    if (!taken.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    // Extremely unlikely; guarantee termination with a random suffix.
    return `${base}-${randomBytes(3).toString('hex')}`;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Members — list
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List members of a workspace (any active member may view). Each entry joins
   * the membership (role/status/isDefault) with the resolved user identity when
   * the userKey matches a User.keycloakId OR a local user id, and surfaces
   * pending `invite:<token>` rows as invites (no user yet).
   */
  async listMembers(user: User, workspaceId: string) {
    await this.requireMember(user, workspaceId);

    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });

    // Resolve identities in one batch. The userKey is uchub sub == keycloakId
    // for SSO users, but local/portal users have no keycloakId and are keyed by
    // local id — so match on EITHER.
    const realKeys = memberships.map((m) => m.userKey).filter((k) => !k.startsWith('invite:'));
    const users = realKeys.length
      ? await this.prisma.user.findMany({
          where: {
            OR: [{ keycloakId: { in: realKeys } }, { id: { in: realKeys } }],
          },
          select: {
            id: true,
            keycloakId: true,
            email: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];
    const byKey = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.keycloakId) byKey.set(u.keycloakId, u);
      byKey.set(u.id, u);
    }

    return memberships.map((m) => {
      const pending = m.userKey.startsWith('invite:');
      const u = pending ? undefined : byKey.get(m.userKey);
      return {
        userKey: m.userKey,
        role: m.role,
        status: m.status,
        isDefault: m.isDefault,
        pending,
        createdAt: m.createdAt,
        user: u
          ? {
              id: u.id,
              email: u.email,
              firstName: u.firstName,
              lastName: u.lastName,
              name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
            }
          : null,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Members — add / share
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add (or re-share with) a member by email. OWNER or ADMIN only.
   *
   *  - If the email matches an existing User → create/re-activate an ACTIVE
   *    Membership on their userKey (keycloakId ?? id). Immediate access.
   *  - If no user exists yet → create a provisional `invite:<token>` membership
   *    (the same control-plane binding inviteToPortal/clientSignup use) and
   *    return a shareable invite link. When that person signs up via the link,
   *    clientSignup reconciles the token onto their real userKey.
   *
   * Idempotent on (userKey, workspaceId) so re-sharing doesn't error.
   */
  async addMember(user: User, workspaceId: string, dto: AddMemberDto) {
    await this.requireRole(user, workspaceId, WorkspaceRole.ADMIN);

    const email = dto.email.trim();
    const role = dto.role ?? WorkspaceRole.MEMBER;

    // Guard: an ADMIN cannot grant OWNER via the share path (DTO already omits
    // OWNER, but enforce in case of a hand-rolled request). Co-owners are added
    // via the role-change endpoint by an existing OWNER.
    if (role === WorkspaceRole.OWNER) {
      throw new BadRequestException(
        'Cannot grant OWNER by invite; use the role-change endpoint as an OWNER',
      );
    }

    // Match an existing user CASE-INSENSITIVELY: the codebase stores emails with
    // their original case (login/findByEmail compare exact), so a strict
    // lowercase lookup could miss a stored mixed-case email and wrongly issue an
    // invite to someone who already has an account. A case-insensitive match is
    // strictly safer here.
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existing) {
      const userKey = MembershipService.membershipKey(existing);
      const member = await this.prisma.membership.upsert({
        where: { userKey_workspaceId: { userKey, workspaceId } },
        update: { role, status: MembershipStatus.ACTIVE },
        create: {
          userKey,
          workspaceId,
          role,
          status: MembershipStatus.ACTIVE,
          isDefault: false,
        },
      });

      await this.audit.log({
        workspaceId,
        userId: user.id,
        action: 'CREATE',
        resource: 'Membership',
        resourceId: userKey,
        details: { email, role, mode: 'existing-user' },
      });
      this.logger.log(
        `Member added: ${email} -> ${role}@${workspaceId} by ${user.email} (existing user)`,
      );

      return {
        kind: 'member' as const,
        userKey: member.userKey,
        role: member.role,
        email,
        invited: false,
      };
    }

    // Client portal signup requires an actual Contact and must remain separate
    // from staff workspace membership. Never issue an unusable portal token.
    throw new BadRequestException(
      'For a new user, ask the workspace owner to create a manual invitation token in workspace settings.',
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Members — change role
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Change a member's role. OWNER only. Never demote the LAST active OWNER
   * (that would orphan the workspace). Promoting another member to OWNER is
   * allowed (co-owner). A no-op same-role change is allowed (idempotent).
   */
  async updateMemberRole(
    user: User,
    workspaceId: string,
    targetUserKey: string,
    newRole: WorkspaceRole,
  ) {
    await this.requireRole(user, workspaceId, WorkspaceRole.OWNER);

    const target = await this.prisma.membership.findUnique({
      where: { userKey_workspaceId: { userKey: targetUserKey, workspaceId } },
    });
    if (!target || target.status !== MembershipStatus.ACTIVE) {
      throw new NotFoundException('Member not found in this workspace');
    }

    // Last-owner protection: if the target is currently the SOLE active OWNER
    // and we're moving them off OWNER, refuse.
    if (target.role === WorkspaceRole.OWNER && newRole !== WorkspaceRole.OWNER) {
      const owners = await this.activeOwnerCount(workspaceId);
      if (owners <= 1) {
        throw new BadRequestException(
          'Cannot demote the last owner. Promote another member to OWNER first.',
        );
      }
    }

    const updated = await this.prisma.membership.update({
      where: { userKey_workspaceId: { userKey: targetUserKey, workspaceId } },
      data: { role: newRole },
    });

    await this.audit.log({
      workspaceId,
      userId: user.id,
      action: 'UPDATE',
      resource: 'Membership',
      resourceId: targetUserKey,
      details: { from: target.role, to: newRole },
    });
    this.logger.log(
      `Member role changed: ${targetUserKey} ${target.role}->${newRole} @${workspaceId} by ${user.email}`,
    );

    return {
      userKey: updated.userKey,
      role: updated.role,
      status: updated.status,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Members — remove
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Remove a member (hard-delete the membership row). OWNER only. Blocks
   * removing the last active OWNER. Pending `invite:<token>` rows can always be
   * removed (revoking an outstanding invite).
   */
  async removeMember(user: User, workspaceId: string, targetUserKey: string) {
    await this.requireRole(user, workspaceId, WorkspaceRole.OWNER);

    const target = await this.prisma.membership.findUnique({
      where: { userKey_workspaceId: { userKey: targetUserKey, workspaceId } },
    });
    if (!target) {
      throw new NotFoundException('Member not found in this workspace');
    }

    if (target.role === WorkspaceRole.OWNER && target.status === MembershipStatus.ACTIVE) {
      const owners = await this.activeOwnerCount(workspaceId);
      if (owners <= 1) {
        throw new BadRequestException('Cannot remove the last owner. Transfer ownership first.');
      }
    }

    await this.prisma.membership.delete({
      where: { userKey_workspaceId: { userKey: targetUserKey, workspaceId } },
    });

    await this.audit.log({
      workspaceId,
      userId: user.id,
      action: 'DELETE',
      resource: 'Membership',
      resourceId: targetUserKey,
      details: { role: target.role, pending: targetUserKey.startsWith('invite:') },
    });
    this.logger.log(
      `Member removed: ${targetUserKey} (${target.role}) @${workspaceId} by ${user.email}`,
    );

    return { removed: true, userKey: targetUserKey };
  }

  private frontendUrl(): string {
    return this.config.get<string>('FRONTEND_URL') || 'https://projectops.unicorncommander.ai';
  }
}
