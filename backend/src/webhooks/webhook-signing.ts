import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { WebhookEventEnvelope } from './webhook-events';

/** HTTP header carrying the HMAC-SHA256 signature of the raw body. */
export const SIGNATURE_HEADER = 'X-ProjectOps-Signature';
/** HTTP header carrying the event name (lets a receiver route without parsing). */
export const EVENT_HEADER = 'X-ProjectOps-Event';
/** HTTP header carrying the delivery id (lets a receiver dedupe retries). */
export const DELIVERY_HEADER = 'X-ProjectOps-Delivery';

/** Bytes of entropy for a generated endpoint secret (32B → 64 hex chars). */
const SECRET_BYTES = 32;

/**
 * Generate a fresh endpoint signing secret. Returned to the caller exactly once
 * (on create / rotate), like a Personal Access Token — we never echo it again.
 */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(SECRET_BYTES).toString('hex')}`;
}

/**
 * Serialize an envelope to the canonical wire body. Centralized so the bytes we
 * SIGN are byte-identical to the bytes we SEND (sign-what-you-send): the caller
 * signs this string and POSTs this same string.
 */
export function serializeEnvelope(envelope: WebhookEventEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Compute the hex HMAC-SHA256 of `rawBody` under `secret`. This is the value
 * placed (prefixed with `sha256=`) in the X-ProjectOps-Signature header; a
 * receiver recomputes it over the raw request body to verify authenticity.
 */
export function computeSignature(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** The full header value: `sha256=<hex>`. */
export function signatureHeaderValue(secret: string, rawBody: string): string {
  return `sha256=${computeSignature(secret, rawBody)}`;
}

/**
 * Constant-time verification helper (the contract a receiver implements; also
 * exercised by tests). Accepts the full `sha256=<hex>` header value.
 */
export function verifySignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined | null,
): boolean {
  if (!signatureHeader) return false;
  const expected = signatureHeaderValue(secret, rawBody);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  // timingSafeEqual throws on length mismatch — guard so a wrong-length header
  // is a clean `false`, not an exception, and the comparison stays constant-time
  // for equal-length inputs.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
