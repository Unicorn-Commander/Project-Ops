/**
 * Typed client for the outbound-webhooks endpoints (`/api/v1/webhooks`).
 *
 * An outbound webhook is a workspace-scoped HTTPS sink the backend POSTs signed
 * domain events to (task/project lifecycle). Management is ADMIN/MANAGER-only
 * server-side; this module is a thin transport — auth + the active
 * `X-Workspace-Id` header are injected by the shared axios instance (`@/lib/api`),
 * so every call is already scoped to the caller in the active workspace.
 *
 * Wire shapes mirror the backend WebhooksService EXACTLY:
 *   GET    /webhooks                       -> WebhookEndpoint[]   (secret masked → secretHint)
 *   POST   /webhooks   {url,events,description?}                  -> CreatedWebhookEndpoint (secret ONCE)
 *   GET    /webhooks/:id                    -> WebhookEndpoint
 *   PATCH  /webhooks/:id   {url?,events?,enabled?,description?,rotateSecret?}
 *                                            -> WebhookEndpoint | CreatedWebhookEndpoint (secret ONCE if rotated)
 *   DELETE /webhooks/:id                    -> { message }
 *   GET    /webhooks/:id/deliveries?limit&offset -> DeliveryPage
 *   POST   /webhooks/:id/test               -> { deliveryId, status }
 *
 * SECRET HANDLING: the signing secret is generated server-side and returned in
 * the `secret` field ONLY on create and on a rotate (`rotateSecret: true`).
 * Every read thereafter exposes a non-reversible `secretHint` ("…ab12") and
 * never the secret itself — surface it show-once, exactly like a PAT.
 */

import api from "@/lib/api";

/**
 * The catalog of subscribable events, mirroring the backend `WEBHOOK_EVENTS`.
 * `description` is UI copy explaining what each event signals to an integrator.
 */
export const WEBHOOK_EVENTS = [
  { name: "task.created", description: "A task was created." },
  { name: "task.status_changed", description: "A task moved to a new status." },
  { name: "task.assigned", description: "A task was assigned to someone." },
  { name: "task.completed", description: "A task was marked complete." },
  { name: "project.created", description: "A project was created." },
  {
    name: "project.status_changed",
    description: "A project moved to a new status.",
  },
  {
    name: "task.comment.created",
    description: "A comment was posted on a task.",
  },
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number]["name"];

/** All event names as a plain array (e.g. for "select all"). */
export const WEBHOOK_EVENT_NAMES: WebhookEventName[] = WEBHOOK_EVENTS.map(
  (e) => e.name,
);

/** Delivery lifecycle, mirroring the backend `WebhookDeliveryStatus` enum. */
export type WebhookDeliveryStatus = "PENDING" | "SUCCESS" | "FAILED";

/**
 * A webhook endpoint as returned by the backend. The raw `secret` is NEVER
 * serialized — only the last-4 `secretHint` is, for recognition.
 */
export interface WebhookEndpoint {
  id: string;
  workspaceId: string;
  url: string;
  /** Non-reversible recognition hint, e.g. "…ab12". Never the real secret. */
  secretHint: string;
  /** Subscribed event names (subset of WEBHOOK_EVENT_NAMES). */
  events: string[];
  enabled: boolean;
  description: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * The response to a create / secret-rotate. Carries the plaintext signing
 * `secret` EXACTLY ONCE — it is never returned again by any other call.
 */
export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  /** Plaintext signing secret (`whsec_…`). Show once, then it's gone. */
  secret: string;
}

/** One row of the delivery log. */
export interface WebhookDelivery {
  id: string;
  workspaceId: string;
  endpointId: string;
  /** Event name, or `ping` for a test delivery. */
  event: string;
  /** The exact envelope that was (or will be) POSTed. */
  payload: unknown;
  status: WebhookDeliveryStatus;
  /** HTTP status the receiver returned, when an attempt completed. */
  responseCode: number | null;
  /** How many POST attempts have been made (1 initial + retries). */
  attempts: number;
  /** Failure detail (network error / non-2xx summary), when failed. */
  error: string | null;
  createdAt: string;
  /** When the delivery settled (SUCCESS/FAILED), else null while PENDING. */
  deliveredAt: string | null;
}

/** Paginated delivery log, mirroring the backend's `{ data, total, limit, offset }`. */
export interface WebhookDeliveryPage {
  data: WebhookDelivery[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
  description?: string;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: string[];
  enabled?: boolean;
  description?: string;
  /** Set true to rotate the signing secret; the new secret returns once. */
  rotateSecret?: boolean;
}

export interface ListDeliveriesParams {
  limit?: number;
  offset?: number;
}

/** True iff a successful update returned a freshly-rotated plaintext secret. */
export function isCreatedWebhookEndpoint(
  endpoint: WebhookEndpoint | CreatedWebhookEndpoint,
): endpoint is CreatedWebhookEndpoint {
  return typeof (endpoint as CreatedWebhookEndpoint).secret === "string";
}

/** List the workspace's webhook endpoints (newest first; secrets masked). */
export async function listWebhooks(): Promise<WebhookEndpoint[]> {
  const res = await api.get<WebhookEndpoint[]>("/webhooks");
  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Create an endpoint. The response carries the signing `secret` ONCE — the
 * caller must surface it immediately (it can never be retrieved again).
 */
export async function createWebhook(
  input: CreateWebhookInput,
): Promise<CreatedWebhookEndpoint> {
  const res = await api.post<CreatedWebhookEndpoint>("/webhooks", input);
  return res.data;
}

/**
 * Update an endpoint. Returns the masked endpoint, OR — when `rotateSecret`
 * was set — a {@link CreatedWebhookEndpoint} whose `secret` is the new
 * plaintext, shown once. Narrow with {@link isCreatedWebhookEndpoint}.
 */
export async function updateWebhook(
  id: string,
  input: UpdateWebhookInput,
): Promise<WebhookEndpoint | CreatedWebhookEndpoint> {
  const res = await api.patch<WebhookEndpoint | CreatedWebhookEndpoint>(
    `/webhooks/${id}`,
    input,
  );
  return res.data;
}

/** Delete an endpoint (cascade-deletes its delivery log server-side). */
export async function deleteWebhook(id: string): Promise<void> {
  await api.delete(`/webhooks/${id}`);
}

/** Recent delivery log for an endpoint, newest first, paginated. */
export async function listDeliveries(
  id: string,
  params?: ListDeliveriesParams,
): Promise<WebhookDeliveryPage> {
  const res = await api.get<WebhookDeliveryPage>(`/webhooks/${id}/deliveries`, {
    params,
  });
  return res.data;
}

/** Send a synthetic `ping` so the receiver can be verified end-to-end. */
export async function testWebhook(
  id: string,
): Promise<{ deliveryId: string; status: WebhookDeliveryStatus }> {
  const res = await api.post<{
    deliveryId: string;
    status: WebhookDeliveryStatus;
  }>(`/webhooks/${id}/test`);
  return res.data;
}
