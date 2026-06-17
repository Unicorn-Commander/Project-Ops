import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  NotificationEntityType,
  NotificationType,
  NotificationsService,
} from './notifications.service';

/**
 * Payload of the `task.comment.created` event (emitted by the tasks module when
 * a comment is added to a task). The notifications module subscribes to it and
 * fans out MENTION notifications — the tasks module stays decoupled (it just
 * emits; it doesn't know notifications exist), mirroring how RealtimeGateway
 * consumes `comment.*` / `timeEntry.*` events.
 */
export interface TaskCommentCreatedEvent {
  workspaceId: string;
  taskId: string;
  commentId: string;
  authorId: string;
  content: string;
}

/**
 * Payload of an optional `task.assigned` event. Consumed ONLY if the tasks
 * module already emits it (it does not today — this is forward-compatible and
 * the notifications module never edits tasks to add the emit). When present, a
 * single ASSIGNED notification is created for the assignee (unless they
 * assigned themselves).
 */
export interface TaskAssignedEvent {
  workspaceId: string;
  taskId: string;
  assignedToId: string;
  assignedById?: string | null;
  title?: string | null;
}

/**
 * Event-driven notification fan-out.
 *
 * Listeners run OUTSIDE any request, so they own their workspace tx via
 * NotificationsService (which uses `runInWorkspace`). Every handler is
 * defensive: a malformed/foreign payload is logged and skipped rather than
 * throwing (an uncaught listener rejection would otherwise surface as an
 * unhandled promise rejection).
 */
@Injectable()
export class NotificationsListener {
  private readonly logger = new Logger(NotificationsListener.name);

  constructor(private readonly notifications: NotificationsService) {}

  @OnEvent('task.comment.created')
  async handleTaskCommentCreated(payload: TaskCommentCreatedEvent): Promise<void> {
    if (
      !payload?.workspaceId ||
      !payload?.taskId ||
      !payload?.authorId ||
      typeof payload?.content !== 'string'
    ) {
      this.logger.warn('Ignoring malformed task.comment.created payload');
      return;
    }

    try {
      await this.notifications.createMentionNotifications({
        workspaceId: payload.workspaceId,
        content: payload.content,
        authorId: payload.authorId,
        entityType: NotificationEntityType.TASK,
        entityId: payload.taskId,
        title: 'You were mentioned in a task comment',
      });
    } catch (err) {
      this.logger.error(
        `Failed to fan out mentions for task comment ${payload.commentId}: ${
          (err as Error).message
        }`,
      );
    }
  }

  @OnEvent('task.assigned')
  async handleTaskAssigned(payload: TaskAssignedEvent): Promise<void> {
    if (!payload?.workspaceId || !payload?.taskId || !payload?.assignedToId) {
      this.logger.warn('Ignoring malformed task.assigned payload');
      return;
    }
    // Don't notify someone who assigned the task to themselves.
    if (payload.assignedById && payload.assignedById === payload.assignedToId) {
      return;
    }

    try {
      await this.notifications.create({
        workspaceId: payload.workspaceId,
        userId: payload.assignedToId,
        type: NotificationType.ASSIGNED,
        title: 'You were assigned a task',
        body: payload.title ?? null,
        entityType: NotificationEntityType.TASK,
        entityId: payload.taskId,
        actorId: payload.assignedById ?? null,
      });
    } catch (err) {
      this.logger.error(
        `Failed to create ASSIGNED notification for task ${payload.taskId}: ${
          (err as Error).message
        }`,
      );
    }
  }
}
