import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Notification, Prisma, User, UserRole } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { clampLimit, clampOffset } from '../common/pagination/clamp';
import { parseMentions } from './mention.util';
import {
  NotificationPreferences,
  applyPreferencePatch,
  mergePreferences,
} from './notification-preferences';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';

/**
 * Input for {@link NotificationsService.create}. `userId` is the RECIPIENT's
 * LOCAL `User.id` (notifications fan out to local users, not uchub subs);
 * `actorId` is the local id of whoever triggered it (optional — system events
 * have no actor).
 */
export interface CreateNotificationInput {
  workspaceId: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
}

/** Canonical notification type strings. */
export const NotificationType = {
  MENTION: 'MENTION',
  ASSIGNED: 'ASSIGNED',
} as const;

/** Canonical entity-type tags stamped onto a notification's source. */
export const NotificationEntityType = {
  TASK: 'TASK',
  PROJECT: 'PROJECT',
} as const;

/**
 * Notifications + @mention fan-out (Collaboration / Push B).
 *
 * SUITE TENANCY: every Notification read/write runs inside the workspace RLS
 * transaction. Request-scoped reads/writes go through
 * `workspaceContext.runForUser(user, tx => ..., workspaceId)` (which also
 * authorizes membership when tenancy is on); event-driven fan-out (no request
 * user) goes through `workspaceContext.runInWorkspace(workspaceId, ucUid, tx =>
 * ...)`. All notification-owned DB access uses the passed `tx`, never
 * `this.prisma`, so the GUC scopes it to the active workspace. ON TOP of the
 * workspace RLS fence, every recipient-facing query additionally filters by
 * `userId` so a member only ever sees their OWN notifications.
 *
 * `createMentionNotifications` is the shared fan-out used by BOTH the task
 * comment listener and the project CommentsService — it parses @mentions,
 * resolves them to workspace members, drops the author, and writes one MENTION
 * row per remaining recipient inside a single workspace tx.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly membership: MembershipService,
  ) {}

  // ── Writes ───────────────────────────────────────────────────────────────

  /**
   * Create one notification inside `workspaceId`'s RLS transaction. Used by
   * system/event paths (no request user); `ucUid` attribution falls back to the
   * actor when present.
   */
  async create(input: CreateNotificationInput): Promise<Notification> {
    return this.workspaceContext.runInWorkspace(input.workspaceId, input.actorId ?? null, (tx) =>
      this.createInTx(tx, input),
    );
  }

  /**
   * Create one notification inside an existing workspace tx. Lets a caller that
   * already holds a workspace-scoped transaction (e.g. CommentsService) fan out
   * in the SAME tx + membership authorization.
   */
  async createInTx(tx: WorkspaceTxClient, input: CreateNotificationInput): Promise<Notification> {
    return tx.notification.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actorId: input.actorId ?? null,
      },
    });
  }

  /**
   * Parse @mentions from `content`, resolve them to ACTIVE workspace members,
   * drop the author, and create one MENTION notification per remaining
   * recipient — all inside `workspaceId`'s RLS transaction. Returns the created
   * rows (empty when nothing/no-one to notify). Safe to call on every comment:
   * a comment with no mentions is a couple of cheap reads and zero writes.
   */
  async createMentionNotifications(params: {
    workspaceId: string;
    content: string;
    authorId: string;
    entityType: string;
    entityId: string;
    /** Title for the generated notification (e.g. "You were mentioned in a task comment"). */
    title?: string;
    ucUid?: string | null;
  }): Promise<Notification[]> {
    const { workspaceId, content, authorId, entityType, entityId } = params;
    const title = params.title ?? 'You were mentioned in a comment';

    if (!parseMentions(content).all.length) {
      return [];
    }

    return this.workspaceContext.runInWorkspace(
      workspaceId,
      params.ucUid ?? authorId ?? null,
      async (tx) => {
        const recipientIds = await this.resolveMentionedUserIds(tx, workspaceId, content, authorId);
        if (recipientIds.length === 0) return [];

        const rows = await Promise.all(
          recipientIds.map((userId) =>
            this.createInTx(tx, {
              workspaceId,
              userId,
              type: NotificationType.MENTION,
              title,
              body: this.snippet(content),
              entityType,
              entityId,
              actorId: authorId,
            }),
          ),
        );

        this.logger.log(
          `Fanned out ${rows.length} MENTION notification(s) for ${entityType} ${entityId} ws=${workspaceId}`,
        );
        return rows;
      },
    );
  }

  /**
   * Mark a single notification (owned by `user`) read. Idempotent: re-marking an
   * already-read row is a no-op that returns the row unchanged. 404s when the id
   * is not the current user's notification in the active workspace (RLS scopes
   * by workspace; the explicit `userId` filter scopes to the owner).
   */
  async markRead(workspaceId: string, user: User, id: string): Promise<Notification> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Scope the update by BOTH id and userId so a member can never flip
        // someone else's notification (RLS already fences the workspace).
        const result = await tx.notification.updateMany({
          where: { id, userId: user.id, readAt: null },
          data: { readAt: new Date() },
        });

        if (result.count === 0) {
          // Either already read, or not ours/not found. Disambiguate with a
          // scoped read so an already-read row returns 200 (idempotent) and a
          // truly-missing one returns 404.
          const existing = await tx.notification.findFirst({
            where: { id, userId: user.id },
          });
          if (!existing) {
            throw new NotFoundException(`Notification ${id} not found`);
          }
          return existing;
        }

        // Return the freshly-updated row.
        return tx.notification.findFirstOrThrow({
          where: { id, userId: user.id },
        });
      },
      workspaceId,
    );
  }

  /**
   * Mark ALL of the current user's unread notifications read in the active
   * workspace. Returns the number updated.
   */
  async markAllRead(workspaceId: string, user: User): Promise<{ updated: number }> {
    const { count } = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.notification.updateMany({
          where: { userId: user.id, readAt: null },
          data: { readAt: new Date() },
        }),
      workspaceId,
    );
    return { updated: count };
  }

  // ── Email preferences ──────────────────────────────────────────────────────
  //
  // These govern EMAIL delivery ONLY (see notification-preferences.ts). In-app
  // notifications above are unaffected. `User.notificationPreferences` is a
  // global, per-user column (the User table is NOT workspace-RLS-fenced —
  // matching capacity/users services that read+write it via `this.prisma.user`),
  // so we scope strictly by the authenticated `user.id`, not the workspace.

  /**
   * The caller's email-notification preferences, merged OVER the defaults
   * (so the result is always complete; a null column => full defaults).
   */
  async getPreferences(user: User): Promise<NotificationPreferences> {
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { notificationPreferences: true },
    });
    return mergePreferences(row?.notificationPreferences ?? null);
  }

  /**
   * Apply a PARTIAL update to the caller's email-notification preferences and
   * persist the full normalized object to `User.notificationPreferences`.
   * Returns the new merged preferences. The patch is shallow-merged over the
   * CURRENT prefs (email replaced if sent; events merged key-by-key), then
   * re-normalized so stray keys are dropped.
   */
  async updatePreferences(
    user: User,
    patch: UpdatePreferencesDto,
  ): Promise<NotificationPreferences> {
    const current = await this.getPreferences(user);
    const next = applyPreferencePatch(current, patch);
    await this.prisma.user.update({
      where: { id: user.id },
      // Prisma typings expect InputJsonValue for a Json column; the object is
      // plain + JSON-safe by construction.
      data: { notificationPreferences: next as unknown as Prisma.InputJsonValue },
    });
    this.logger.log(`Updated email notification preferences for user ${user.id}`);
    return next;
  }

  /**
   * Resolve a recipient (by LOCAL User.id) into the data the email listener
   * needs: their address, display name, and merged email preferences. Returns
   * null when the user is missing/inactive/has no email — the caller then skips
   * the email silently. Reads the global User row directly (not workspace-scoped).
   */
  async resolveEmailRecipient(userId: string): Promise<{
    email: string;
    name: string;
    preferences: NotificationPreferences;
    keycloakId: string | null;
    role: UserRole;
  } | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        keycloakId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        notificationPreferences: true,
      },
    });
    if (!u || !u.isActive || !u.email) return null;
    const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email;
    return {
      email: u.email,
      name,
      preferences: mergePreferences(u.notificationPreferences),
      keycloakId: u.keycloakId,
      role: u.role,
    };
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * List the current user's notifications in the active workspace, newest
   * first, paginated. `unreadOnly` restricts to rows with `readAt IS NULL`.
   */
  async findForUser(
    workspaceId: string,
    user: User,
    params: { skip?: number; take?: number; unreadOnly?: boolean },
  ): Promise<{ notifications: Notification[]; total: number; unreadCount: number }> {
    const take = clampLimit(params.take);
    const skip = clampOffset(params.skip);

    const where: Prisma.NotificationWhereInput = { userId: user.id };
    if (params.unreadOnly) where.readAt = null;

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [notifications, total, unreadCount] = await Promise.all([
          tx.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip,
            take,
          }),
          tx.notification.count({ where }),
          // Always surface the unread badge count alongside the page, regardless
          // of the unreadOnly filter, so the client never needs a second call.
          tx.notification.count({ where: { userId: user.id, readAt: null } }),
        ]);
        return { notifications, total, unreadCount };
      },
      workspaceId,
    );
  }

  /** The current user's unread notification count in the active workspace. */
  async unreadCount(workspaceId: string, user: User): Promise<number> {
    return this.workspaceContext.runForUser(
      user,
      (tx) => tx.notification.count({ where: { userId: user.id, readAt: null } }),
      workspaceId,
    );
  }

  // ── Mention resolution ─────────────────────────────────────────────────────

  /**
   * Resolve the @mention handles in `content` to the set of LOCAL `User.id`s
   * that are ACTIVE members of `workspaceId`, EXCLUDING `excludeUserId` (the
   * author). Deduped; unknown handles are silently ignored.
   *
   * Membership keys are `User.keycloakId ?? User.id` (MembershipService
   * convention). We read the workspace's active member keys, then resolve the
   * mentioned handles (`@username` / `@email`, both unique columns) to Users and
   * keep only those whose key is a member.
   *
   * Tenancy-OFF fallback: in single-tenant mode there may be NO membership rows
   * (everything resolves to DEFAULT_WORKSPACE_ID and the gate is a no-op). When
   * the workspace has zero member keys, we treat every active user as eligible
   * so @mentions still work pre-tenancy — matching how the rest of the app
   * behaves with the flag off.
   *
   * Runs inside an existing workspace `tx` so it shares the caller's RLS scope
   * and (for the request paths) the same membership authorization.
   */
  async resolveMentionedUserIds(
    tx: WorkspaceTxClient,
    workspaceId: string,
    content: string,
    excludeUserId?: string | null,
  ): Promise<string[]> {
    const { emails, usernames } = parseMentions(content);
    if (emails.length === 0 && usernames.length === 0) return [];

    // Candidate users matching the mentioned handles (unique username/email).
    // Match case-insensitively: usernames/emails are stored as-entered but
    // handles were lowercased by the parser.
    const handleFilters: Prisma.UserWhereInput[] = [];
    if (usernames.length) {
      handleFilters.push({
        username: { in: usernames, mode: Prisma.QueryMode.insensitive },
      });
    }
    if (emails.length) {
      handleFilters.push({
        email: { in: emails, mode: Prisma.QueryMode.insensitive },
      });
    }

    const candidates = await tx.user.findMany({
      where: { isActive: true, OR: handleFilters },
      select: { id: true, keycloakId: true },
    });
    if (candidates.length === 0) return [];

    // The active member-key set for this workspace.
    const memberKeys = await this.activeMemberKeys(tx, workspaceId);

    const recipients = new Set<string>();
    for (const u of candidates) {
      if (excludeUserId && u.id === excludeUserId) continue;
      // memberKeys empty => single-tenant / unseeded => everyone is eligible.
      if (memberKeys.size > 0) {
        const key = u.keycloakId ?? u.id;
        if (!memberKeys.has(key)) continue;
      }
      recipients.add(u.id);
    }
    return [...recipients];
  }

  /**
   * Resolve the @mention recipients of `content` (LOCAL User.ids, author
   * excluded) inside `workspaceId`'s RLS transaction — the SAME audience the
   * in-app MENTION fan-out targets. Exposed for the email listener so the email
   * audience exactly matches the in-app one without reaching into private state.
   * Returns [] (no tx opened) when there are no @mentions.
   */
  async resolveMentionRecipients(params: {
    workspaceId: string;
    content: string;
    authorId: string;
  }): Promise<string[]> {
    if (!parseMentions(params.content).all.length) return [];
    return this.workspaceContext.runInWorkspace(params.workspaceId, params.authorId, (tx) =>
      this.resolveMentionedUserIds(tx, params.workspaceId, params.content, params.authorId),
    );
  }

  /** The set of ACTIVE membership keys (userKey) for a workspace. */
  private async activeMemberKeys(tx: WorkspaceTxClient, workspaceId: string): Promise<Set<string>> {
    const members = await tx.membership.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      select: { userKey: true },
    });
    return new Set(members.map((m) => m.userKey));
  }

  /** A short, single-line body snippet from the source content. */
  private snippet(content: string, max = 140): string {
    const oneLine = content.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
  }
}
