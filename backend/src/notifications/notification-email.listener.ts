import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { EmailService } from '../email/email.service';
import { NotificationsService } from './notifications.service';
import { NotificationEmailContent } from '../email/templates/notification.template';
import { shouldEmail } from './notification-preferences';

/**
 * EMAIL-on-notification fan-out (closes the Settings "Notifications — coming
 * soon" stub).
 *
 * This listener runs IN PARALLEL with {@link NotificationsListener}: that one
 * owns IN-APP notification creation (unchanged), this one owns the EMAIL side.
 * Keeping them separate means the email layer can never regress in-app
 * delivery — an email failure is fully isolated.
 *
 * For each notify-worthy Wave-2 domain event we:
 *   1. resolve the recipient (by local User.id) + their email + merged prefs,
 *   2. run the {@link shouldEmail} gate (master toggle ON + this event's key ON
 *      + recipient is NOT the actor),
 *   3. confirm email is configured for the deployment,
 *   4. render a concise branded email (subject + one-line body + deep link) and
 *      send it via {@link EmailService.sendNotificationEmail}.
 *
 * RESILIENCE: every handler is wrapped so an email failure (bad payload, SMTP
 * down, missing user) is logged and swallowed — it never throws out of the
 * listener and never touches the in-app notification path.
 *
 * SCOPE: immediate per-event email only. DIGEST / BATCHING IS OUT OF SCOPE —
 * the clean extension point is `notification-preferences.ts`'s reserved
 * `digest` block plus a future scheduled flusher; nothing here batches.
 */
@Injectable()
export class NotificationEmailListener {
  private readonly logger = new Logger(NotificationEmailListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ── Event handlers ─────────────────────────────────────────────────────────

  @OnEvent('task.assigned')
  async onTaskAssigned(payload: {
    workspaceId?: string;
    taskId?: string;
    assignedToId?: string;
    actorId?: string | null;
    task?: { title?: string | null; projectId?: string | null };
  }): Promise<void> {
    await this.guard('task.assigned', async () => {
      if (!payload?.assignedToId || !payload?.taskId) return;
      const title = payload.task?.title ?? 'a task';
      await this.dispatch({
        eventName: 'task.assigned',
        recipientUserId: payload.assignedToId,
        actorUserId: payload.actorId ?? null,
        content: (actorName) => ({
          subject: `New task assigned: ${title}`,
          headline: 'New task assigned',
          body: `${actorName} assigned you the task "${title}".`,
          url: this.taskUrl(payload.task?.projectId ?? null, payload.taskId!),
          cta: 'View task',
        }),
      });
    });
  }

  @OnEvent('task.comment.created')
  async onTaskCommentCreated(payload: {
    workspaceId?: string;
    taskId?: string;
    commentId?: string;
    authorId?: string;
    content?: string;
  }): Promise<void> {
    await this.guard('task.comment.created', async () => {
      if (!payload?.workspaceId || !payload?.taskId || !payload?.authorId) return;
      if (typeof payload.content !== 'string' || !payload.content) return;

      // Resolve the SAME @mention recipients the in-app fan-out uses, so the
      // email audience exactly matches the in-app one.
      const recipientIds = await this.notifications.resolveMentionRecipients({
        workspaceId: payload.workspaceId,
        content: payload.content,
        authorId: payload.authorId,
      });
      if (recipientIds.length === 0) return;

      const snippet = this.snippet(payload.content);
      // Each recipient is gated + sent independently; one failure can't block the rest.
      await Promise.all(
        recipientIds.map((recipientUserId) =>
          this.dispatch({
            eventName: 'task.comment.created',
            recipientUserId,
            actorUserId: payload.authorId ?? null,
            content: (actorName) => ({
              subject: `${actorName} mentioned you in a comment`,
              headline: 'You were mentioned',
              body: `${actorName} mentioned you: "${snippet}"`,
              url: this.taskUrl(null, payload.taskId!),
              cta: 'View comment',
            }),
          }),
        ),
      );
    });
  }

  @OnEvent('task.status_changed')
  async onTaskStatusChanged(payload: {
    taskId?: string;
    fromStatus?: string;
    toStatus?: string;
    actorId?: string | null;
    task?: { title?: string | null; assignedToId?: string | null; projectId?: string | null };
  }): Promise<void> {
    await this.guard('task.status_changed', async () => {
      const recipient = payload.task?.assignedToId;
      if (!recipient || !payload?.taskId) return;
      const title = payload.task?.title ?? 'a task';
      await this.dispatch({
        eventName: 'task.status_changed',
        recipientUserId: recipient,
        actorUserId: payload.actorId ?? null,
        content: (actorName) => ({
          subject: `Task status updated: ${title}`,
          headline: 'Task status updated',
          body: `${actorName} changed "${title}" from ${this.pretty(payload.fromStatus)} to ${this.pretty(payload.toStatus)}.`,
          url: this.taskUrl(payload.task?.projectId ?? null, payload.taskId!),
          cta: 'View task',
        }),
      });
    });
  }

  @OnEvent('task.completed')
  async onTaskCompleted(payload: {
    taskId?: string;
    actorId?: string | null;
    task?: { title?: string | null; assignedToId?: string | null; projectId?: string | null };
  }): Promise<void> {
    await this.guard('task.completed', async () => {
      const recipient = payload.task?.assignedToId;
      if (!recipient || !payload?.taskId) return;
      const title = payload.task?.title ?? 'a task';
      await this.dispatch({
        eventName: 'task.completed',
        recipientUserId: recipient,
        actorUserId: payload.actorId ?? null,
        content: (actorName) => ({
          subject: `Task completed: ${title}`,
          headline: 'Task completed',
          body: `${actorName} marked "${title}" complete.`,
          url: this.taskUrl(payload.task?.projectId ?? null, payload.taskId!),
          cta: 'View task',
        }),
      });
    });
  }

  @OnEvent('task.created')
  async onTaskCreated(payload: {
    taskId?: string;
    actorId?: string | null;
    task?: { title?: string | null; assignedToId?: string | null; projectId?: string | null };
  }): Promise<void> {
    await this.guard('task.created', async () => {
      // A created-with-assignee task already fires task.assigned (handled above);
      // task.created email is OFF by default and only addresses the assignee.
      const recipient = payload.task?.assignedToId;
      if (!recipient || !payload?.taskId) return;
      const title = payload.task?.title ?? 'a task';
      await this.dispatch({
        eventName: 'task.created',
        recipientUserId: recipient,
        actorUserId: payload.actorId ?? null,
        content: (actorName) => ({
          subject: `New task: ${title}`,
          headline: 'New task created',
          body: `${actorName} created the task "${title}".`,
          url: this.taskUrl(payload.task?.projectId ?? null, payload.taskId!),
          cta: 'View task',
        }),
      });
    });
  }

  @OnEvent('project.status_changed')
  async onProjectStatusChanged(payload: {
    projectId?: string;
    fromStatus?: string;
    toStatus?: string;
    actorId?: string | null;
    project?: { title?: string | null; assignedToId?: string | null };
  }): Promise<void> {
    await this.guard('project.status_changed', async () => {
      const recipient = payload.project?.assignedToId;
      if (!recipient || !payload?.projectId) return;
      const title = payload.project?.title ?? 'a project';
      await this.dispatch({
        eventName: 'project.status_changed',
        recipientUserId: recipient,
        actorUserId: payload.actorId ?? null,
        content: (actorName) => ({
          subject: `Project status updated: ${title}`,
          headline: 'Project status updated',
          body: `${actorName} changed "${title}" from ${this.pretty(payload.fromStatus)} to ${this.pretty(payload.toStatus)}.`,
          url: this.projectUrl(payload.projectId!),
          cta: 'View project',
        }),
      });
    });
  }

  @OnEvent('project.created')
  async onProjectCreated(payload: {
    projectId?: string;
    actorId?: string | null;
    project?: { title?: string | null; assignedToId?: string | null };
  }): Promise<void> {
    await this.guard('project.created', async () => {
      const recipient = payload.project?.assignedToId;
      if (!recipient || !payload?.projectId) return;
      const title = payload.project?.title ?? 'a project';
      await this.dispatch({
        eventName: 'project.created',
        recipientUserId: recipient,
        actorUserId: payload.actorId ?? null,
        content: (actorName) => ({
          subject: `New project: ${title}`,
          headline: 'New project created',
          body: `${actorName} created the project "${title}".`,
          url: this.projectUrl(payload.projectId!),
          cta: 'View project',
        }),
      });
    });
  }

  @OnEvent('timesheet.submitted')
  async onTimesheetSubmitted(payload: {
    approverId?: string | null;
    reviewerId?: string | null;
    actorId?: string | null;
    userId?: string | null;
    periodId?: string;
    timesheetPeriodId?: string;
  }): Promise<void> {
    await this.guard('timesheet.submitted', async () => {
      // The submitted timesheet is a request for an APPROVER to act. Email that
      // approver (whatever the payload calls them); never email the submitter.
      const recipient = payload.approverId ?? payload.reviewerId ?? null;
      const periodId = payload.periodId ?? payload.timesheetPeriodId ?? null;
      if (!recipient) return;
      await this.dispatch({
        eventName: 'timesheet.submitted',
        recipientUserId: recipient,
        actorUserId: payload.actorId ?? payload.userId ?? null,
        content: (actorName) => ({
          subject: 'Approval requested: timesheet submitted',
          headline: 'Approval requested',
          body: `${actorName} submitted a timesheet for your approval.`,
          url: periodId
            ? `${this.baseUrl()}/dashboard/time/approvals?period=${periodId}`
            : `${this.baseUrl()}/dashboard/time/approvals`,
          cta: 'Review timesheet',
        }),
      });
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * The shared send pipeline for one (event, recipient) pair: resolve the
   * recipient + prefs, gate, confirm email is configured, render, send. Every
   * step is null-safe and the whole thing is invoked under {@link guard}.
   */
  private async dispatch(params: {
    eventName: string;
    recipientUserId: string;
    actorUserId: string | null;
    content: (actorName: string) => NotificationEmailContent;
  }): Promise<void> {
    const { eventName, recipientUserId, actorUserId } = params;

    // Cheap, synchronous gate first (actor-is-recipient short-circuits before any DB).
    if (actorUserId && actorUserId === recipientUserId) return;

    const recipient = await this.notifications.resolveEmailRecipient(recipientUserId);
    if (!recipient) return;

    if (
      !shouldEmail({
        eventName,
        prefs: recipient.preferences,
        recipientUserId,
        actorUserId,
      })
    ) {
      return;
    }

    // Only hit SMTP config once the prefs gate passes.
    if (!(await this.email.isConfigured())) return;

    const actorName = actorUserId
      ? ((await this.notifications.resolveEmailRecipient(actorUserId))?.name ?? 'Someone')
      : 'Project Ops';

    const result = await this.email.sendNotificationEmail(
      recipient.email,
      recipient.name,
      params.content(actorName),
    );
    if (!result.success) {
      // sendNotificationEmail already logged; record the gated-but-failed send.
      this.logger.warn(`Notification email for ${eventName} not delivered: ${result.message}`);
    }
  }

  /**
   * Wrap a handler so NOTHING escapes: a thrown error (malformed payload, DB or
   * SMTP failure) is logged and swallowed. The in-app notification path lives in
   * a different listener and is unaffected regardless.
   */
  private async guard(eventName: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.error(
        `Email listener for ${eventName} failed (swallowed): ${(err as Error).message}`,
      );
    }
  }

  /** App base URL from config (same key + default the rest of the app uses). */
  private baseUrl(): string {
    return this.config.get<string>('FRONTEND_URL', 'https://projectops.unicorncommander.ai');
  }

  /** Deep link to a task (mirrors tasks.service: project page focused on the task). */
  private taskUrl(projectId: string | null, taskId: string): string {
    return projectId
      ? `${this.baseUrl()}/dashboard/projects/${projectId}?task=${taskId}`
      : `${this.baseUrl()}/dashboard/tasks/${taskId}`;
  }

  /** Deep link to a project. */
  private projectUrl(projectId: string): string {
    return `${this.baseUrl()}/dashboard/projects/${projectId}`;
  }

  /** Title-case a SCREAMING_SNAKE status for human-readable email copy. */
  private pretty(status?: string | null): string {
    if (!status) return 'updated';
    return status
      .toLowerCase()
      .split('_')
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(' ');
  }

  /** A short single-line snippet of comment content for the email body. */
  private snippet(content: string, max = 120): string {
    const oneLine = content.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
  }
}
