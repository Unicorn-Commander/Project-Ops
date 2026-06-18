import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WEBHOOK_EVENTS, WebhookEventEnvelope, WebhookEventName } from './webhook-events';

/**
 * Minimal contract the webhooks fan-out needs from ANY domain event: a
 * workspace to scope by. The full payload is forwarded verbatim as the
 * envelope `data`, so subscribers receive whatever the domain module emitted —
 * the webhooks module stays decoupled and doesn't need to know each event's
 * exact shape.
 */
interface WorkspaceScopedEvent {
  workspaceId?: string;
  [key: string]: unknown;
}

/**
 * Outbound-webhook fan-out.
 *
 * Subscribes to the Project-Ops domain events (emitted by the tasks / projects
 * modules via EventEmitter2) and, for each, finds the enabled endpoints in that
 * workspace subscribed to the event and dispatches a signed delivery. Mirrors
 * NotificationsListener: the domain modules just emit; they don't know webhooks
 * exist.
 *
 * RESILIENCE: every handler funnels through {@link dispatch}, which catches and
 * logs ALL errors. A listener that throws would surface as an unhandled promise
 * rejection — so nothing here is allowed to escape. Subscribing to an event the
 * codebase doesn't emit yet (e.g. `task.created`) is simply dormant.
 *
 * NOTE: handlers do NOT await delivery. The domain emit is fire-and-forget
 * (emitted outside the originating request's workspace tx); we likewise fan out
 * asynchronously so a slow receiver never adds latency to — or rolls back — the
 * action that produced the event. The DB delivery row is the durable record.
 */
@Injectable()
export class WebhooksListener {
  private readonly logger = new Logger(WebhooksListener.name);

  constructor(
    private readonly webhooks: WebhooksService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  @OnEvent('task.created')
  onTaskCreated(payload: WorkspaceScopedEvent): void {
    this.dispatch('task.created', payload);
  }

  @OnEvent('task.status_changed')
  onTaskStatusChanged(payload: WorkspaceScopedEvent): void {
    this.dispatch('task.status_changed', payload);
  }

  @OnEvent('task.assigned')
  onTaskAssigned(payload: WorkspaceScopedEvent): void {
    this.dispatch('task.assigned', payload);
  }

  @OnEvent('task.completed')
  onTaskCompleted(payload: WorkspaceScopedEvent): void {
    this.dispatch('task.completed', payload);
  }

  @OnEvent('project.created')
  onProjectCreated(payload: WorkspaceScopedEvent): void {
    this.dispatch('project.created', payload);
  }

  @OnEvent('project.status_changed')
  onProjectStatusChanged(payload: WorkspaceScopedEvent): void {
    this.dispatch('project.status_changed', payload);
  }

  @OnEvent('task.comment.created')
  onTaskCommentCreated(payload: WorkspaceScopedEvent): void {
    this.dispatch('task.comment.created', payload);
  }

  /**
   * Resolve subscribers and fire deliveries for `event`. Synchronous entry
   * (so @OnEvent never sees a rejected promise); the async work is detached and
   * fully guarded. Exposed (internal) so tests can drive it directly.
   */
  dispatch(event: WebhookEventName, payload: WorkspaceScopedEvent): void {
    const workspaceId = payload?.workspaceId;
    if (!workspaceId) {
      this.logger.warn(`Ignoring ${event}: payload has no workspaceId`);
      return;
    }

    // Detach the async fan-out; swallow everything so a delivery failure can
    // never become an unhandled rejection.
    void this.fanOut(event, workspaceId, payload).catch((err) => {
      this.logger.error(
        `Webhook fan-out crashed for ${event} (ws=${workspaceId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  private async fanOut(
    event: WebhookEventName,
    workspaceId: string,
    payload: WorkspaceScopedEvent,
  ): Promise<void> {
    const targets = await this.webhooks.findEnabledTargetsForEvent(workspaceId, event);
    if (targets.length === 0) return;

    const envelope: WebhookEventEnvelope = {
      event,
      workspaceId,
      data: payload,
      timestamp: new Date().toISOString(),
    };

    this.logger.log(`Dispatching ${event} to ${targets.length} endpoint(s) (ws=${workspaceId})`);
    await this.delivery.deliverToTargets(workspaceId, targets, envelope);
  }
}

/** Re-export the catalog so an importer of the listener has the event list handy. */
export { WEBHOOK_EVENTS };
