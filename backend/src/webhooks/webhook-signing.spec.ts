import { createHmac } from 'crypto';
import {
  computeSignature,
  generateWebhookSecret,
  serializeEnvelope,
  signatureHeaderValue,
  verifySignature,
} from './webhook-signing';
import { WebhookEventEnvelope } from './webhook-events';

const envelope: WebhookEventEnvelope = {
  event: 'task.created',
  workspaceId: 'ws-1',
  data: { id: 't1', title: 'Hello' },
  timestamp: '2026-06-18T00:00:00.000Z',
};

describe('webhook-signing', () => {
  it('computes an HMAC-SHA256 hex digest of the raw body under the secret', () => {
    const secret = 'whsec_000000000000';
    const body = serializeEnvelope(envelope);

    const expected = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    expect(computeSignature(secret, body)).toBe(expected);
  });

  it('prefixes the header value with sha256=', () => {
    const body = serializeEnvelope(envelope);
    const header = signatureHeaderValue('whsec_000000000000', body);
    expect(header).toBe(`sha256=${computeSignature('whsec_000000000000', body)}`);
    expect(header.startsWith('sha256=')).toBe(true);
  });

  it('verifies a correctly-signed body (round trip)', () => {
    const secret = generateWebhookSecret();
    const body = serializeEnvelope(envelope);
    const header = signatureHeaderValue(secret, body);
    expect(verifySignature(secret, body, header)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const secret = generateWebhookSecret();
    const body = serializeEnvelope(envelope);
    const header = signatureHeaderValue(secret, body);
    const tampered = body.replace('Hello', 'Goodbye');
    expect(verifySignature(secret, tampered, header)).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const body = serializeEnvelope(envelope);
    const header = signatureHeaderValue('secret-a', body);
    expect(verifySignature('secret-b', body, header)).toBe(false);
  });

  it('rejects a missing or malformed signature header without throwing', () => {
    const body = serializeEnvelope(envelope);
    expect(verifySignature('s', body, undefined)).toBe(false);
    expect(verifySignature('s', body, null)).toBe(false);
    expect(verifySignature('s', body, 'sha256=short')).toBe(false);
  });

  it('generates unique, prefixed, high-entropy secrets', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).not.toBe(b);
    expect(a.startsWith('whsec_')).toBe(true);
    // 32 bytes => 64 hex chars after the prefix.
    expect(a.length).toBe('whsec_'.length + 64);
  });
});
