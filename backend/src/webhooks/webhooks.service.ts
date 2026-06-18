import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { User, WebhookDelivery, WebhookEndpoint } from '@prisma/client';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { WorkspaceTxClient } from '../prisma/prisma.service';
import { clampLimit, clampOffset } from '../common/pagination/clamp';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { WEBHOOK_PING_EVENT, WebhookEventEnvelope, isKnownWebhookEvent } from './webhook-events';
import { generateWebhookSecret } from './webhook-signing';
import { DeliveryTarget, WebhookDeliveryService } from './webhook-delivery.service';

/**
 * Endpoint as returned to clients: the raw `secret` is NEVER serialized. We
 * expose only a non-reversible `secretHint` (last 4 chars) so the UI can show
 * "…ab12" for recognition without leaking the signing key.
 */
export type SafeWebhookEndpoint = Omit<WebhookEndpoint, 'secret'> & { secretHint: string };

/** A create/rotate response additionally carries the plaintext secret ONCE. */
export type CreatedWebhookEndpoint = SafeWebhookEndpoint & { secret: string };

/**
 * Outbound webhooks — endpoint CRUD + the read side of the delivery log.
 *
 * SUITE TENANCY: every DB access runs through the workspace RLS chokepoint. All
 * request paths use `workspaceContext.runForUser(user, tx => …, workspaceId)`
 * (which also authorizes membership when tenancy is on) and touch only the
 * passed `tx`, so the GUC scopes every query to the active workspace. The
 * listener-facing `findEnabledTargetsForEvent` runs in `runInWorkspace` (no
 * request user).
 *
 * SECRET HANDLING: the signing secret is generated server-side, returned ONCE on
 * create/rotate (like a PAT), and thereafter only ever surfaced as a last-4
 * hint. There is no read endpoint that returns it.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly delivery: WebhookDeliveryService,
  ) {}

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /** List the workspace's endpoints (newest first). Secrets are masked. */
  async list(workspaceId: string, user: User): Promise<SafeWebhookEndpoint[]> {
    const rows = await this.workspaceContext.runForUser(
      user,
      (tx) => tx.webhookEndpoint.findMany({ orderBy: { createdAt: 'desc' } }),
      workspaceId,
    );
    return rows.map((r) => this.toSafe(r));
  }

  /** Fetch one endpoint (masked). 404 when not in the active workspace. */
  async findOne(workspaceId: string, user: User, id: string): Promise<SafeWebhookEndpoint> {
    const row = await this.workspaceContext.runForUser(
      user,
      (tx) => this.getOrThrow(tx, id),
      workspaceId,
    );
    return this.toSafe(row);
  }

  /**
   * Create an endpoint. Validates the URL (https, or http only for loopback) and
   * that every requested event is known; generates the signing secret. The
   * plaintext secret is returned ONCE here and never again.
   */
  async create(
    workspaceId: string,
    user: User,
    dto: CreateWebhookDto,
  ): Promise<CreatedWebhookEndpoint> {
    this.assertDeliverableUrl(dto.url);
    const events = this.normalizeEvents(dto.events);
    const secret = generateWebhookSecret();

    const row = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.webhookEndpoint.create({
          data: {
            workspaceId,
            url: dto.url,
            secret,
            events,
            description: dto.description ?? null,
            enabled: true,
            createdById: user.id,
          },
        }),
      workspaceId,
    );

    this.logger.log(
      `Webhook endpoint ${row.id} created (ws=${workspaceId}, events=${events.length})`,
    );
    // Return the plaintext secret exactly once.
    return { ...this.toSafe(row), secret };
  }

  /**
   * Update an endpoint (url/events/enabled/description, optional secret rotate).
   * When `rotateSecret` is set, a new secret is generated and returned ONCE in
   * the response (`secret`); otherwise the response is masked.
   */
  async update(
    workspaceId: string,
    user: User,
    id: string,
    dto: UpdateWebhookDto,
  ): Promise<SafeWebhookEndpoint | CreatedWebhookEndpoint> {
    if (dto.url !== undefined) this.assertDeliverableUrl(dto.url);
    const events = dto.events !== undefined ? this.normalizeEvents(dto.events) : undefined;
    const rotatedSecret = dto.rotateSecret ? generateWebhookSecret() : undefined;

    const row = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Scope the update to the workspace (RLS) + id; 404 if absent so a
        // cross-workspace id can't be probed.
        await this.getOrThrow(tx, id);
        return tx.webhookEndpoint.update({
          where: { id },
          data: {
            ...(dto.url !== undefined ? { url: dto.url } : {}),
            ...(events !== undefined ? { events } : {}),
            ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
            ...(dto.description !== undefined ? { description: dto.description } : {}),
            ...(rotatedSecret ? { secret: rotatedSecret } : {}),
          },
        });
      },
      workspaceId,
    );

    this.logger.log(
      `Webhook endpoint ${id} updated (ws=${workspaceId}${rotatedSecret ? ', secret rotated' : ''})`,
    );
    const safe = this.toSafe(row);
    return rotatedSecret ? { ...safe, secret: rotatedSecret } : safe;
  }

  /** Delete an endpoint (cascade-deletes its deliveries via the FK). */
  async remove(workspaceId: string, user: User, id: string): Promise<{ message: string }> {
    await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        await this.getOrThrow(tx, id);
        await tx.webhookEndpoint.delete({ where: { id } });
      },
      workspaceId,
    );
    this.logger.log(`Webhook endpoint ${id} deleted (ws=${workspaceId})`);
    return { message: 'Webhook endpoint deleted successfully' };
  }

  // ── Deliveries ───────────────────────────────────────────────────────────────

  /** Recent delivery log for an endpoint, newest first, paginated. */
  async listDeliveries(
    workspaceId: string,
    user: User,
    id: string,
    params: { limit?: number; offset?: number },
  ): Promise<{ data: WebhookDelivery[]; total: number; limit: number; offset: number }> {
    const take = clampLimit(params.limit);
    const skip = clampOffset(params.offset);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Ensure the endpoint exists in this workspace before listing its log.
        await this.getOrThrow(tx, id);
        const [data, total] = await Promise.all([
          tx.webhookDelivery.findMany({
            where: { endpointId: id },
            orderBy: { createdAt: 'desc' },
            take,
            skip,
          }),
          tx.webhookDelivery.count({ where: { endpointId: id } }),
        ]);
        return { data, total, limit: take, offset: skip };
      },
      workspaceId,
    );
  }

  /**
   * Send a synthetic `ping` delivery to an endpoint so the owner can verify their
   * receiver (URL reachable + signature validates). Goes through the same signed
   * delivery + retry + recording path as a real event.
   */
  async sendTest(
    workspaceId: string,
    user: User,
    id: string,
  ): Promise<{ deliveryId: string; status: string }> {
    const endpoint = await this.workspaceContext.runForUser(
      user,
      (tx) => this.getOrThrow(tx, id),
      workspaceId,
    );

    const envelope: WebhookEventEnvelope = {
      event: WEBHOOK_PING_EVENT,
      workspaceId,
      data: { endpointId: endpoint.id, message: 'Project-Ops webhook test ping' },
      timestamp: new Date().toISOString(),
    };

    const outcome = await this.delivery.deliver(workspaceId, this.toTarget(endpoint), envelope);
    return { deliveryId: outcome.deliveryId, status: outcome.status };
  }

  // ── Listener-facing ──────────────────────────────────────────────────────────

  /**
   * The enabled endpoints in `workspaceId` subscribed to `event`, as delivery
   * targets (id/url/secret). Runs in the workspace RLS tx (no request user). The
   * `events` array filter is done in-app because Prisma's `has` maps to the
   * Postgres array-contains operator and we keep the query trivially correct.
   */
  async findEnabledTargetsForEvent(workspaceId: string, event: string): Promise<DeliveryTarget[]> {
    const rows = await this.workspaceContext.runInWorkspace(workspaceId, null, (tx) =>
      tx.webhookEndpoint.findMany({
        where: { enabled: true, events: { has: event } },
        select: { id: true, url: true, secret: true },
      }),
    );
    return rows.map((r) => ({ id: r.id, url: r.url, secret: r.secret }));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /** Fetch an endpoint within the current tx or 404 (RLS already scopes the ws). */
  private async getOrThrow(tx: WorkspaceTxClient, id: string): Promise<WebhookEndpoint> {
    const row = await tx.webhookEndpoint.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`Webhook endpoint ${id} not found`);
    }
    return row;
  }

  /** Validate + dedupe the requested event names against the known catalog. */
  private normalizeEvents(events: string[]): string[] {
    const deduped = [...new Set(events)];
    const unknown = deduped.filter((e) => !isKnownWebhookEvent(e));
    if (unknown.length) {
      throw new BadRequestException(`Unknown webhook event(s): ${unknown.join(', ')}`);
    }
    return deduped;
  }

  /**
   * Enforce the transport rule: https required, EXCEPT http is allowed when the
   * host is loopback (localhost / 127.0.0.1 / [::1]) for local dev receivers.
   * Anything else (other schemes, plain http to a public host) is rejected so a
   * secret-bearing signed POST never crosses the wire in clear text.
   */
  private assertDeliverableUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Webhook url must be a valid absolute URL');
    }

    const host = parsed.hostname.toLowerCase();
    const isLoopback =
      host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';

    if (parsed.protocol === 'https:') return;
    if (parsed.protocol === 'http:' && isLoopback) return;

    throw new BadRequestException(
      'Webhook url must use https (http is allowed only for localhost/127.0.0.1 dev receivers)',
    );
  }

  /** Strip the secret, append a last-4 hint. */
  private toSafe(row: WebhookEndpoint): SafeWebhookEndpoint {
    const { secret, ...rest } = row;
    return { ...rest, secretHint: this.maskSecret(secret) };
  }

  private toTarget(row: WebhookEndpoint): DeliveryTarget {
    return { id: row.id, url: row.url, secret: row.secret };
  }

  /** Non-reversible recognition hint: `…<last4>` (or `…` for short/empty). */
  private maskSecret(secret: string): string {
    if (!secret || secret.length < 4) return '…';
    return `…${secret.slice(-4)}`;
  }
}
