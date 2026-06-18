import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, TaskStatus, User } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { WithWorkspaceClaim } from '../common/workspace/workspace.util';

/**
 * Capacity / resource planning (Wave 2).
 *
 * SUITE TENANCY: Task is an RLS-scoped table, so EVERY task read runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` — the GUC
 * chokepoint that fences the query to the active workspace (mirrors
 * TasksService). The `memberships` + `users` tables are control-plane (NOT
 * under RLS — see WorkspacesService) so member/identity resolution reads
 * `this.prisma` DIRECTLY, exactly like WorkspacesService.listMembers; forcing
 * those through `withWorkspace` would scope to the wrong fence and is moot for
 * non-RLS tables. The two are bridged: we list the workspace's members
 * (control-plane), then aggregate THEIR task load inside the workspace tx.
 *
 * Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off (membership
 * resolution is a no-op and withWorkspace runs under the BYPASSRLS owner
 * connection).
 */

/** A resolved planning window, inclusive of both bounds. */
export interface CapacityWindow {
  from: Date;
  to: Date;
}

/** A single member of the workspace, with the identity needed to render a row. */
export interface WorkspaceMemberIdentity {
  /** Local User.id — the key tasks are assigned by (Task.assignedToId). */
  userId: string;
  /** Display name, falling back to email when no first/last name. */
  name: string;
  /** The user's configured weekly hours budget (null => the schema default). */
  weeklyCapacityHours: number | null;
}

/** Raw per-assignee task aggregates, straight off the grouped queries. */
export interface AssigneeWorkload {
  /** Sum of estimatedHours over in-window, not-done, estimated tasks. */
  committedHours: number;
  /** All in-window, not-done assigned tasks (estimated or not). */
  taskCount: number;
  /** In-window, not-done assigned tasks with NO estimate (the visible gap). */
  unestimatedCount: number;
}

/** One row of the per-user capacity report. */
export interface UserCapacityRow {
  userId: string;
  name: string;
  capacityHours: number;
  committedHours: number;
  utilizationPct: number;
  overAllocated: boolean;
  taskCount: number;
  unestimatedCount: number;
}

/** The full capacity report: per-user rows + workspace rollup + the window. */
export interface CapacityReport {
  from: string;
  to: string;
  windowDays: number;
  users: UserCapacityRow[];
  totals: {
    capacityHours: number;
    committedHours: number;
    utilizationPct: number;
    overAllocatedCount: number;
    taskCount: number;
    unestimatedCount: number;
  };
}

/** Default weekly capacity when a user's column is null (matches the schema @default). */
export const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class CapacityService {
  private readonly logger = new Logger(CapacityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  // ───────────────────────────────────────────────────────────────────────────
  // Pure helpers (no DB) — unit-tested directly.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Resolve the planning window from optional ISO `from`/`to`. When either is
   * omitted, default to the CURRENT WEEK: Monday 00:00:00.000 → Sunday
   * 23:59:59.999 (local server time — correct on the backend). When both are
   * supplied they are used verbatim. Validates `from <= to`.
   *
   * `now` is injectable so the default-week branch is deterministic in tests.
   */
  resolveWindow(from?: string, to?: string, now: Date = new Date()): CapacityWindow {
    if (from && to) {
      const f = new Date(from);
      const t = new Date(to);
      if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
        throw new BadRequestException('Invalid from/to date');
      }
      if (f.getTime() > t.getTime()) {
        throw new BadRequestException('`from` must be on or before `to`');
      }
      return { from: f, to: t };
    }
    // Default: the current week (Mon→Sun) in server-local time.
    return CapacityService.currentWeek(now);
  }

  /** Monday 00:00:00.000 → Sunday 23:59:59.999 of the week containing `now`. */
  static currentWeek(now: Date): CapacityWindow {
    const start = new Date(now);
    // JS getDay(): 0=Sun..6=Sat. Shift so Monday is the first day of the week.
    const day = start.getDay();
    const daysSinceMonday = (day + 6) % 7;
    start.setDate(start.getDate() - daysSinceMonday);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    return { from: start, to: end };
  }

  /**
   * Inclusive window length in days, used to pro-rate the weekly budget. A
   * Mon→Sun week is 7 days. Always at least 1 (a same-day window is one day).
   * Computed from calendar-day boundaries so DST shifts can't yield a fractional
   * count.
   */
  static windowDays(window: CapacityWindow): number {
    const startDay = new Date(
      window.from.getFullYear(),
      window.from.getMonth(),
      window.from.getDate(),
    ).getTime();
    const endDay = new Date(
      window.to.getFullYear(),
      window.to.getMonth(),
      window.to.getDate(),
    ).getTime();
    const days = Math.floor((endDay - startDay) / MS_PER_DAY) + 1;
    return Math.max(1, days);
  }

  /**
   * Pro-rate a weekly capacity to the window: `weekly * (windowDays / 7)`,
   * rounded to 2 decimals. A null/undefined weekly budget falls back to the
   * schema default (40h).
   */
  static proratedCapacity(
    weeklyCapacityHours: number | null | undefined,
    windowDays: number,
  ): number {
    const weekly =
      weeklyCapacityHours === null || weeklyCapacityHours === undefined
        ? DEFAULT_WEEKLY_CAPACITY_HOURS
        : weeklyCapacityHours;
    return round2((weekly * windowDays) / 7);
  }

  /**
   * Assemble one report row from a member + their (possibly absent) workload.
   * Utilization is committed/capacity as a percentage (0 when capacity is 0, to
   * avoid divide-by-zero / Infinity). Over-allocated when committed strictly
   * exceeds capacity. This is the single source of truth for the row math, so
   * the per-user and `/me` paths (and the tests) all agree.
   */
  static buildRow(
    member: WorkspaceMemberIdentity,
    workload: AssigneeWorkload | undefined,
    windowDays: number,
  ): UserCapacityRow {
    const committedHours = round2(workload?.committedHours ?? 0);
    const capacityHours = CapacityService.proratedCapacity(member.weeklyCapacityHours, windowDays);
    const utilizationPct = capacityHours > 0 ? round2((committedHours / capacityHours) * 100) : 0;
    return {
      userId: member.userId,
      name: member.name,
      capacityHours,
      committedHours,
      utilizationPct,
      overAllocated: committedHours > capacityHours,
      taskCount: workload?.taskCount ?? 0,
      unestimatedCount: workload?.unestimatedCount ?? 0,
    };
  }

  /** Roll per-user rows up into workspace totals. */
  static buildTotals(rows: UserCapacityRow[]): CapacityReport['totals'] {
    const capacityHours = round2(rows.reduce((s, r) => s + r.capacityHours, 0));
    const committedHours = round2(rows.reduce((s, r) => s + r.committedHours, 0));
    return {
      capacityHours,
      committedHours,
      utilizationPct: capacityHours > 0 ? round2((committedHours / capacityHours) * 100) : 0,
      overAllocatedCount: rows.filter((r) => r.overAllocated).length,
      taskCount: rows.reduce((s, r) => s + r.taskCount, 0),
      unestimatedCount: rows.reduce((s, r) => s + r.unestimatedCount, 0),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Member resolution (control-plane: direct prisma, like WorkspacesService).
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The ACTIVE, real (non-invite) members of `workspaceId`, resolved to local
   * User identities. Mirrors WorkspacesService.listMembers exactly: memberships
   * + users are NOT RLS-scoped, so read them via `this.prisma`, and a membership
   * userKey is the uchub `sub` (== User.keycloakId) for SSO users but the local
   * id for local/portal users — so match on EITHER. Pending `invite:<token>`
   * rows (no user yet) and inactive users are dropped: neither can hold task
   * load. Batched (one membership query + one user query) — no N+1.
   */
  async listActiveMembers(workspaceId: string): Promise<WorkspaceMemberIdentity[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { workspaceId, status: MembershipStatus.ACTIVE },
      orderBy: { createdAt: 'asc' },
    });

    const realKeys = memberships.map((m) => m.userKey).filter((k) => !k.startsWith('invite:'));
    if (realKeys.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { isActive: true },
          { OR: [{ keycloakId: { in: realKeys } }, { id: { in: realKeys } }] },
        ],
      },
      select: {
        id: true,
        keycloakId: true,
        email: true,
        firstName: true,
        lastName: true,
        weeklyCapacityHours: true,
      },
    });

    // Map each membership key (keycloakId or local id) to the resolved user.
    const byKey = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.keycloakId) byKey.set(u.keycloakId, u);
      byKey.set(u.id, u);
    }

    // De-dupe on local User.id: a user could in principle match both keys, and a
    // membership keyed by keycloakId + a stale one keyed by local id must not
    // double-count. Preserve membership (createdAt) order.
    const seen = new Set<string>();
    const result: WorkspaceMemberIdentity[] = [];
    for (const m of memberships) {
      if (m.userKey.startsWith('invite:')) continue;
      const u = byKey.get(m.userKey);
      if (!u || seen.has(u.id)) continue;
      seen.add(u.id);
      result.push({
        userId: u.id,
        name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email,
        weeklyCapacityHours: u.weeklyCapacityHours,
      });
    }
    return result;
  }

  /** Resolve a single active member of the workspace by local User.id, or null. */
  async findActiveMember(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberIdentity | null> {
    const members = await this.listActiveMembers(workspaceId);
    return members.find((m) => m.userId === userId) ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Workload aggregation (RLS-scoped: runs on the passed workspace tx).
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Aggregate per-assignee task load for the window with grouped queries (no
   * N+1). Runs on the workspace `tx`, so RLS already fences it to the active
   * workspace — we don't (and can't) filter by workspaceId in the WHERE. Two
   * grouped passes keyed by assignee:
   *   1) _sum(estimatedHours) + _count over in-window, NOT-done assigned tasks
   *      (committed hours + total task count). Tasks with a null estimate
   *      contribute 0 to the sum but ARE counted in `_all`.
   *   2) _count over the same window where estimatedHours IS NULL (the
   *      un-estimated gap, surfaced so a planner sees hidden work).
   *
   * NOT-done = status NOT IN (COMPLETED, CANCELLED): a cancelled task will never
   * consume capacity, so it isn't "committed" work either. Only assigned tasks
   * (assignedToId not null) and only tasks whose dueDate falls within
   * [from, to]. `restrictToUserIds` narrows the GROUP BY to a known member set.
   */
  async aggregateWorkload(
    tx: WorkspaceTxClient,
    window: CapacityWindow,
    restrictToUserIds: string[],
  ): Promise<Map<string, AssigneeWorkload>> {
    const byUser = new Map<string, AssigneeWorkload>();
    if (restrictToUserIds.length === 0) return byUser;

    const baseWhere = {
      assignedToId: { in: restrictToUserIds },
      status: { notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED] },
      dueDate: { gte: window.from, lte: window.to },
    };

    const [committed, unestimated] = await Promise.all([
      tx.task.groupBy({
        by: ['assignedToId'],
        where: baseWhere,
        _sum: { estimatedHours: true },
        _count: { _all: true },
      }),
      tx.task.groupBy({
        by: ['assignedToId'],
        where: { ...baseWhere, estimatedHours: null },
        _count: { _all: true },
      }),
    ]);

    const unestByUser = new Map<string, number>();
    for (const row of unestimated) {
      if (row.assignedToId) unestByUser.set(row.assignedToId, row._count._all);
    }

    for (const row of committed) {
      const userId = row.assignedToId;
      if (!userId) continue;
      byUser.set(userId, {
        committedHours: decToNum(row._sum.estimatedHours) ?? 0,
        taskCount: row._count._all,
        unestimatedCount: unestByUser.get(userId) ?? 0,
      });
    }
    return byUser;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public report builders.
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The team capacity report for the workspace over the window. Lists every
   * active member (even those with zero load — a planner needs to see free
   * capacity), aggregates their task load in ONE pair of grouped queries, and
   * folds in workspace totals.
   */
  async getTeamCapacity(
    workspaceId: string,
    user: User & Partial<WithWorkspaceClaim>,
    from?: string,
    to?: string,
  ): Promise<CapacityReport> {
    const window = this.resolveWindow(from, to);
    const days = CapacityService.windowDays(window);

    const members = await this.listActiveMembers(workspaceId);
    const memberIds = members.map((m) => m.userId);

    const workloads = await this.workspaceContext.runForUser(
      user,
      (tx) => this.aggregateWorkload(tx, window, memberIds),
      workspaceId,
    );

    const rows = members.map((m) => CapacityService.buildRow(m, workloads.get(m.userId), days));

    return this.assembleReport(window, days, rows);
  }

  /**
   * The CURRENT user's own capacity (so non-managers can see their load). The
   * user must be an active member of the workspace; otherwise there is nothing
   * to report and we 403 (consistent with the membership model). Returns a
   * single-row report so the shape matches the team view.
   */
  async getMyCapacity(
    workspaceId: string,
    user: User & Partial<WithWorkspaceClaim>,
    from?: string,
    to?: string,
  ): Promise<CapacityReport> {
    const window = this.resolveWindow(from, to);
    const days = CapacityService.windowDays(window);

    const member = await this.findActiveMember(workspaceId, user.id);
    if (!member) {
      throw new ForbiddenException('You are not an active member of this workspace.');
    }

    const workloads = await this.workspaceContext.runForUser(
      user,
      (tx) => this.aggregateWorkload(tx, window, [member.userId]),
      workspaceId,
    );

    const row = CapacityService.buildRow(member, workloads.get(member.userId), days);
    return this.assembleReport(window, days, [row]);
  }

  /**
   * Set a member's weekly capacity (ADMIN/MANAGER — gated at the controller).
   * The target MUST be an active member of the active workspace (else 404), so a
   * manager cannot edit a stranger's budget through this workspace. The User row
   * itself is control-plane (not RLS-scoped), so update via `this.prisma` after
   * the membership check. Bounds (0–168) are validated by the DTO.
   */
  async setUserCapacity(
    workspaceId: string,
    targetUserId: string,
    weeklyCapacityHours: number,
  ): Promise<{ userId: string; name: string; weeklyCapacityHours: number }> {
    const member = await this.findActiveMember(workspaceId, targetUserId);
    if (!member) {
      throw new NotFoundException('User is not a member of this workspace.');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { weeklyCapacityHours },
      select: { id: true, email: true, firstName: true, lastName: true, weeklyCapacityHours: true },
    });

    this.logger.log(
      `Capacity set: user ${targetUserId} -> ${weeklyCapacityHours}h/wk in workspace ${workspaceId}`,
    );

    return {
      userId: updated.id,
      name: `${updated.firstName ?? ''} ${updated.lastName ?? ''}`.trim() || updated.email,
      weeklyCapacityHours: updated.weeklyCapacityHours ?? DEFAULT_WEEKLY_CAPACITY_HOURS,
    };
  }

  /** Common report assembly: sort rows (most over-allocated first), add totals. */
  private assembleReport(
    window: CapacityWindow,
    days: number,
    rows: UserCapacityRow[],
  ): CapacityReport {
    // Surface the people in trouble first: highest utilization at the top, then
    // by name for a stable order.
    const sorted = [...rows].sort(
      (a, b) => b.utilizationPct - a.utilizationPct || a.name.localeCompare(b.name),
    );
    return {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      windowDays: days,
      users: sorted,
      totals: CapacityService.buildTotals(sorted),
    };
  }
}

/** Prisma Decimal | null -> number | null (house pattern, see time-tracking/serialize). */
function decToNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  return parseFloat(v.toString());
}

/** Round to 2 decimal places, avoiding float dust (e.g. 0.1+0.2). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
