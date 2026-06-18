import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { WebhookDeliveryStatus } from '@prisma/client';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { WebhookEventEnvelope } from './webhook-events';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  serializeEnvelope,
  signatureHeaderValue,
} from './webhook-signing';

/** Per-request timeout (ms) for an outbound delivery POST. */
const DELIVERY_TIMEOUT_MS = 5_000;
/** Total POST attempts (1 initial + retries) before a delivery is marked FAILED. */
const MAX_ATTEMPTS = 3;
/** Base for exponential backoff between attempts (ms): 500, 1000, 2000, … */
const BACKOFF_BASE_MS = 500;

/** A single endpoint targeted by a delivery (the minimal shape the engine needs). */
export interface DeliveryTarget {
  id: string;
  url: string;
  secret: string;
}

/** Outcome of attempting (and recording) one delivery. */
export interface DeliveryOutcome {
  deliveryId: string;
  status: WebhookDeliveryStatus;
  responseCode: number | null;
  attempts: number;
}

/**
 * Outbound webhook delivery engine.
 *
 * Responsibilities:
 *  - Sign-what-you-send: serialize the envelope ONCE, HMAC-SHA256 those exact
 *    bytes under the endpoint secret, and POST the same bytes with the signature
 *    + event + delivery-id headers.
 *  - Persist a {@link WebhookDelivery} row recording status / responseCode /
 *    attempts / error, inside the endpoint's workspace RLS transaction (no
 *    request user → `runInWorkspace`).
 *  - Retry transient failures with exponential backoff up to {@link MAX_ATTEMPTS};
 *    2xx ⇒ SUCCESS, otherwise FAILED after the last attempt.
 *  - Be TOTALLY resilient: a network error, a non-2xx, or even a DB write hiccup
 *    is caught and logged — `deliver*` never rejects, so a listener fan-out is
 *    never destabilized by one bad endpoint.
 *
 * Delivery is in-process and best-effort (no new infra/deps): the listener fires
 * deliveries on the event loop and they settle on their own microtasks. The DB
 * row is the durable record of what happened.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);

  constructor(private readonly workspaceContext: WorkspaceContextService) {}

  /**
   * Deliver `envelope` to every `target` for `workspaceId`, in parallel. Each
   * delivery is independently recorded + retried; the returned array reports each
   * outcome. Never rejects.
   */
  async deliverToTargets(
    workspaceId: string,
    targets: DeliveryTarget[],
    envelope: WebhookEventEnvelope,
  ): Promise<DeliveryOutcome[]> {
    return Promise.all(targets.map((target) => this.deliver(workspaceId, target, envelope)));
  }

  /**
   * Deliver one envelope to one endpoint: create a PENDING row, attempt the POST
   * with retries, then finalize the row to SUCCESS/FAILED. Returns the outcome;
   * NEVER throws (a failure to even record is swallowed + logged).
   */
  async deliver(
    workspaceId: string,
    target: DeliveryTarget,
    envelope: WebhookEventEnvelope,
  ): Promise<DeliveryOutcome> {
    const rawBody = serializeEnvelope(envelope);

    let deliveryId: string;
    try {
      const row = await this.workspaceContext.runInWorkspace(workspaceId, null, (tx) =>
        tx.webhookDelivery.create({
          data: {
            workspaceId,
            endpointId: target.id,
            event: envelope.event,
            // Persist the EXACT body we sign+send so the stored payload matches
            // the bytes the receiver verified against.
            payload: JSON.parse(rawBody),
            status: WebhookDeliveryStatus.PENDING,
            attempts: 0,
          },
          select: { id: true },
        }),
      );
      deliveryId = row.id;
    } catch (err) {
      // Could not even create the record — log and bail (never throw out).
      this.logger.error(
        `Failed to create delivery row for endpoint ${target.id} (event=${envelope.event}, ws=${workspaceId}): ${this.msg(err)}`,
      );
      return {
        deliveryId: '',
        status: WebhookDeliveryStatus.FAILED,
        responseCode: null,
        attempts: 0,
      };
    }

    const result = await this.attemptWithRetries(target, envelope, rawBody, deliveryId);

    try {
      await this.workspaceContext.runInWorkspace(workspaceId, null, (tx) =>
        tx.webhookDelivery.update({
          where: { id: deliveryId },
          data: {
            status: result.status,
            responseCode: result.responseCode,
            attempts: result.attempts,
            error: result.error,
            deliveredAt: result.status === WebhookDeliveryStatus.SUCCESS ? new Date() : null,
          },
        }),
      );
    } catch (err) {
      this.logger.error(`Failed to finalize delivery ${deliveryId}: ${this.msg(err)}`);
    }

    if (result.status === WebhookDeliveryStatus.SUCCESS) {
      this.logger.log(
        `Delivered ${envelope.event} → endpoint ${target.id} (delivery=${deliveryId}, code=${result.responseCode}, attempts=${result.attempts})`,
      );
    } else {
      this.logger.warn(
        `Delivery FAILED ${envelope.event} → endpoint ${target.id} (delivery=${deliveryId}, attempts=${result.attempts}): ${result.error ?? 'unknown'}`,
      );
    }

    return {
      deliveryId,
      status: result.status,
      responseCode: result.responseCode,
      attempts: result.attempts,
    };
  }

  /**
   * POST the body, retrying on network error or non-2xx with exponential
   * backoff, up to MAX_ATTEMPTS. Resolves with the terminal status + attempt
   * count + last response code/error. Never throws.
   */
  private async attemptWithRetries(
    target: DeliveryTarget,
    envelope: WebhookEventEnvelope,
    rawBody: string,
    deliveryId: string,
  ): Promise<{
    status: WebhookDeliveryStatus;
    responseCode: number | null;
    attempts: number;
    error: string | null;
  }> {
    const headers = {
      'Content-Type': 'application/json',
      [SIGNATURE_HEADER]: signatureHeaderValue(target.secret, rawBody),
      [EVENT_HEADER]: envelope.event,
      [DELIVERY_HEADER]: deliveryId,
    };

    let lastCode: number | null = null;
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await axios.post(target.url, rawBody, {
          headers,
          timeout: DELIVERY_TIMEOUT_MS,
          // We classify status ourselves (don't let axios throw on non-2xx),
          // so 4xx/5xx is a normal value we can record + retry.
          validateStatus: () => true,
          // The body is already a JSON string; send it verbatim so the bytes the
          // receiver hashes equal the bytes we signed.
          transformRequest: [(d) => d],
          maxRedirects: 0,
        });

        lastCode = res.status;
        if (res.status >= 200 && res.status < 300) {
          return {
            status: WebhookDeliveryStatus.SUCCESS,
            responseCode: res.status,
            attempts: attempt,
            error: null,
          };
        }
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        // Network/timeout/DNS error — no HTTP status.
        lastCode = (err as AxiosError)?.response?.status ?? null;
        lastError = this.msg(err);
      }

      // Backoff before the next attempt (skip after the final attempt).
      if (attempt < MAX_ATTEMPTS) {
        await this.sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
      }
    }

    return {
      status: WebhookDeliveryStatus.FAILED,
      responseCode: lastCode,
      attempts: MAX_ATTEMPTS,
      error: lastError,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
