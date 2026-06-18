/**
 * Outbound-webhook domain event catalog.
 *
 * These are the canonical event NAMES a workspace can subscribe a webhook
 * endpoint to. They map 1:1 onto the EventEmitter2 events emitted by the domain
 * modules (tasks / projects) — the WebhooksListener subscribes to each via
 * `@OnEvent` and, for an event a workspace has an enabled endpoint for, enqueues
 * a signed delivery.
 *
 * NOTE: not every event is emitted by the codebase TODAY (e.g. `task.created`,
 * `project.status_changed`). Subscribing to an as-yet-unemitted event is inert
 * and forward-compatible — exactly how NotificationsListener treats the optional
 * `task.assigned` event. The webhooks module never edits a domain module to add
 * an emit; it only consumes.
 */
export const WEBHOOK_EVENTS = [
  'task.created',
  'task.status_changed',
  'task.assigned',
  'task.completed',
  'project.created',
  'project.status_changed',
  'task.comment.created',
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** The known-event set, for O(1) validation of a subscription request. */
export const WEBHOOK_EVENT_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENTS);

/** Synthetic event delivered by `POST /webhooks/:id/test`, never subscribed to. */
export const WEBHOOK_PING_EVENT = 'ping';

/** True iff `name` is a subscribable webhook event. */
export function isKnownWebhookEvent(name: unknown): name is WebhookEventName {
  return typeof name === 'string' && WEBHOOK_EVENT_SET.has(name);
}

/**
 * Canonical wire envelope POSTed to a subscriber. The HMAC signature is computed
 * over the EXACT serialized bytes of this object (see webhook-signing.ts), so the
 * shape here IS the signed contract.
 */
export interface WebhookEventEnvelope {
  /** Event name (one of WEBHOOK_EVENTS, or `ping` for the test delivery). */
  event: string;
  /** Workspace the event belongs to (lets multi-tenant receivers route). */
  workspaceId: string;
  /** Event-specific payload as emitted by the domain module. */
  data: unknown;
  /** ISO-8601 emit time. */
  timestamp: string;
}
