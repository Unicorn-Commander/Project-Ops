import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutomationTrigger } from '@prisma/client';
import { AutomationsService } from './automations.service';
import {
  CommentCreatedEvent,
  ProjectCreatedEvent,
  ProjectStatusChangedEvent,
  TaskAssignedEvent,
  TaskCompletedEvent,
  TaskCreatedEvent,
  TaskStatusChangedEvent,
} from './automation.types';

/**
 * Rules-engine event listener. Subscribes to the domain events emitted by the
 * tasks / projects / comment modules and runs matching enabled automation rules
 * (via AutomationsService.runRulesForEvent).
 *
 * RESILIENCE: every handler validates the payload and delegates to the service,
 * which itself never throws (a failing rule is logged + skipped). A handler that
 * received a malformed payload logs + returns rather than throwing — an uncaught
 * listener rejection would otherwise surface as an unhandled promise rejection.
 *
 * INTEGRATOR NOTE: as of this writing the tasks/projects modules emit only
 * `task.comment.created`. The other events below (`task.created`,
 * `task.status_changed`, `task.assigned`, `task.completed`, `project.created`,
 * `project.status_changed`) are the agreed contract for this feature and must
 * be emitted by TasksService/ProjectsService for the corresponding triggers to
 * fire. Payload shapes are documented in automation.types.ts and restated on
 * each handler. The handlers are inert (no rules match / nothing emitted) until
 * those emits exist, so wiring this module is safe immediately.
 */
@Injectable()
export class AutomationsListener {
  private readonly logger = new Logger(AutomationsListener.name);

  constructor(private readonly automations: AutomationsService) {}

  /** `task.created` -> TASK_CREATED */
  @OnEvent('task.created')
  async onTaskCreated(payload: TaskCreatedEvent): Promise<void> {
    if (!this.requireWorkspaceAnd(payload, 'task.created', payload?.taskId)) return;
    await this.safeRun(AutomationTrigger.TASK_CREATED, payload);
  }

  /**
   * `task.status_changed` -> TASK_STATUS_CHANGED only. TASK_COMPLETED is NOT
   * fired here: TasksService emits a dedicated `task.completed` event on the
   * ->COMPLETED transition (handled by onTaskCompleted), so firing it here too
   * would double-run TASK_COMPLETED rules. This handler owns only the generic
   * status-change trigger.
   */
  @OnEvent('task.status_changed')
  async onTaskStatusChanged(payload: TaskStatusChangedEvent): Promise<void> {
    if (!this.requireWorkspaceAnd(payload, 'task.status_changed', payload?.taskId)) return;
    if (typeof payload.toStatus !== 'string') {
      this.logger.warn('Ignoring task.status_changed: missing toStatus');
      return;
    }
    await this.safeRun(AutomationTrigger.TASK_STATUS_CHANGED, payload);
  }

  /** `task.assigned` -> TASK_ASSIGNED */
  @OnEvent('task.assigned')
  async onTaskAssigned(payload: TaskAssignedEvent): Promise<void> {
    if (!this.requireWorkspaceAnd(payload, 'task.assigned', payload?.taskId)) return;
    if (!payload.assignedToId) {
      this.logger.warn('Ignoring task.assigned: missing assignedToId');
      return;
    }
    await this.safeRun(AutomationTrigger.TASK_ASSIGNED, payload);
  }

  /**
   * `task.completed` -> TASK_COMPLETED. This is the explicit completion event;
   * TASK_COMPLETED rules also fire from the status_changed->COMPLETED path above.
   * If a module emits BOTH for the same transition, the loop-guard depth still
   * applies per-event but completion is naturally idempotent-ish (it's the same
   * rules). Emit only one of the two for a given transition to avoid double-fire.
   */
  @OnEvent('task.completed')
  async onTaskCompleted(payload: TaskCompletedEvent): Promise<void> {
    if (!this.requireWorkspaceAnd(payload, 'task.completed', payload?.taskId)) return;
    await this.safeRun(AutomationTrigger.TASK_COMPLETED, payload);
  }

  /** `project.created` -> PROJECT_CREATED */
  @OnEvent('project.created')
  async onProjectCreated(payload: ProjectCreatedEvent): Promise<void> {
    if (!this.requireWorkspaceAnd(payload, 'project.created', payload?.projectId)) return;
    await this.safeRun(AutomationTrigger.PROJECT_CREATED, payload);
  }

  /**
   * `project.status_changed` -> PROJECT_STATUS_CHANGED.
   *
   * NOTE: distinct from the EXISTING `project.status-changed` (hyphen) event the
   * billing rollup emits with a different payload ({projectId, paymentStatus}) —
   * we deliberately listen on the underscore name to avoid colliding with that
   * unrelated realtime broadcast. The integrator should emit
   * `project.status_changed` from ProjectsService.updateStatus.
   */
  @OnEvent('project.status_changed')
  async onProjectStatusChanged(payload: ProjectStatusChangedEvent): Promise<void> {
    if (!this.requireWorkspaceAnd(payload, 'project.status_changed', payload?.projectId)) return;
    await this.safeRun(AutomationTrigger.PROJECT_STATUS_CHANGED, payload);
  }

  /**
   * `task.comment.created` -> COMMENT_CREATED. This is the SAME event the
   * notifications module already consumes (the tasks module emits it today);
   * multiple @OnEvent subscribers to one event are independent, so adding this
   * subscriber does not disturb notifications.
   */
  @OnEvent('task.comment.created')
  async onCommentCreated(payload: CommentCreatedEvent): Promise<void> {
    if (!this.requireWorkspaceAnd(payload, 'task.comment.created', payload?.taskId)) return;
    await this.safeRun(AutomationTrigger.COMMENT_CREATED, payload);
  }

  // ── helpers ────────────────────────────────────────────────────────────

  /** Validate the common (workspaceId + a primary entity id) shape; log+false on miss. */
  private requireWorkspaceAnd(
    payload: { workspaceId?: string } | null | undefined,
    event: string,
    entityId: string | undefined | null,
  ): boolean {
    if (!payload?.workspaceId || !entityId) {
      this.logger.warn(`Ignoring malformed ${event} payload`);
      return false;
    }
    return true;
  }

  /** Delegate to the engine; the engine never throws, but guard anyway. */
  private async safeRun(trigger: AutomationTrigger, payload: any): Promise<void> {
    try {
      await this.automations.runRulesForEvent(trigger, payload);
    } catch (err) {
      // Defensive: runRulesForEvent is designed not to throw, but a listener
      // must never let a rejection escape.
      this.logger.error(`Automation engine error for ${trigger}: ${(err as Error).message}`);
    }
  }
}
