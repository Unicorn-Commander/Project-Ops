import axios from 'axios';
import { WebhookDeliveryStatus } from '@prisma/client';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookEventEnvelope } from './webhook-events';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  serializeEnvelope,
  verifySignature,
} from './webhook-signing';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

const target = { id: 'wh1', url: 'https://hooks.example.com/in', secret: 'whsec_000000000000' };
const envelope: WebhookEventEnvelope = {
  event: 'task.created',
  workspaceId: 'ws1',
  data: { id: 't1' },
  timestamp: '2026-06-18T00:00:00.000Z',
};

/**
 * Build a service over a fake workspace chokepoint that captures the create +
 * update calls so we can assert what delivery row got recorded.
 */
function makeService() {
  const created: any = { id: 'd1' };
  const createArgs: any[] = [];
  const updateArgs: any[] = [];

  const tx = {
    webhookDelivery: {
      create: jest.fn(async (args: any) => {
        createArgs.push(args);
        return created;
      }),
      update: jest.fn(async (args: any) => {
        updateArgs.push(args);
        return { ...created, ...args.data };
      }),
    },
  };

  const workspaceContext = {
    runInWorkspace: jest.fn(async (_ws: string, _uid: any, fn: (t: any) => any) => fn(tx)),
  };

  const svc = new WebhookDeliveryService(workspaceContext as any);
  return { svc, tx, createArgs, updateArgs };
}

beforeEach(() => {
  mockedPost.mockReset();
  // Make backoff instantaneous + deterministic: run the timer callback now.
  jest.spyOn(global, 'setTimeout').mockImplementation(((fn: (...a: any[]) => void) => {
    fn();
    return 0 as any;
  }) as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('WebhookDeliveryService.deliver', () => {
  it('records SUCCESS on a 2xx after one attempt and signs the exact body sent', async () => {
    mockedPost.mockResolvedValue({ status: 200 });
    const { svc, createArgs, updateArgs } = makeService();

    const outcome = await svc.deliver('ws1', target, envelope);

    expect(outcome.status).toBe(WebhookDeliveryStatus.SUCCESS);
    expect(outcome.responseCode).toBe(200);
    expect(outcome.attempts).toBe(1);

    // PENDING row created first.
    expect(createArgs[0].data).toMatchObject({
      workspaceId: 'ws1',
      endpointId: 'wh1',
      event: 'task.created',
      status: WebhookDeliveryStatus.PENDING,
    });

    // Finalized to SUCCESS with a deliveredAt.
    expect(updateArgs[0].data).toMatchObject({
      status: WebhookDeliveryStatus.SUCCESS,
      responseCode: 200,
      attempts: 1,
    });
    expect(updateArgs[0].data.deliveredAt).toBeInstanceOf(Date);

    // The signature header verifies against the EXACT body bytes POSTed.
    const [url, body, config] = mockedPost.mock.calls[0];
    expect(url).toBe(target.url);
    expect(body).toBe(serializeEnvelope(envelope));
    expect(config.headers[EVENT_HEADER]).toBe('task.created');
    expect(config.headers[DELIVERY_HEADER]).toBe('d1');
    expect(verifySignature(target.secret, body, config.headers[SIGNATURE_HEADER])).toBe(true);
    expect(config.timeout).toBeGreaterThan(0);
  });

  it('retries on non-2xx up to 3 attempts then records FAILED with the last code', async () => {
    mockedPost
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 502 })
      .mockResolvedValueOnce({ status: 503 });
    const { svc, updateArgs } = makeService();

    const outcome = await svc.deliver('ws1', target, envelope);

    expect(mockedPost).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe(WebhookDeliveryStatus.FAILED);
    expect(outcome.attempts).toBe(3);
    expect(outcome.responseCode).toBe(503);
    expect(updateArgs[0].data).toMatchObject({
      status: WebhookDeliveryStatus.FAILED,
      attempts: 3,
      responseCode: 503,
    });
    expect(updateArgs[0].data.deliveredAt).toBeNull();
  });

  it('stops retrying and records SUCCESS as soon as a retry succeeds', async () => {
    mockedPost.mockResolvedValueOnce({ status: 500 }).mockResolvedValueOnce({ status: 204 });
    const { svc } = makeService();

    const outcome = await svc.deliver('ws1', target, envelope);

    expect(mockedPost).toHaveBeenCalledTimes(2);
    expect(outcome.status).toBe(WebhookDeliveryStatus.SUCCESS);
    expect(outcome.responseCode).toBe(204);
    expect(outcome.attempts).toBe(2);
  });

  it('records FAILED with the network error message when the POST throws every time', async () => {
    mockedPost.mockRejectedValue(new Error('ECONNREFUSED'));
    const { svc, updateArgs } = makeService();

    const outcome = await svc.deliver('ws1', target, envelope);

    expect(mockedPost).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe(WebhookDeliveryStatus.FAILED);
    expect(updateArgs[0].data.error).toContain('ECONNREFUSED');
    expect(updateArgs[0].data.responseCode).toBeNull();
  });

  it('NEVER throws even if the POST rejects (resilience)', async () => {
    mockedPost.mockRejectedValue(new Error('boom'));
    const { svc } = makeService();
    await expect(svc.deliver('ws1', target, envelope)).resolves.toBeDefined();
  });

  it('deliverToTargets fans out to every target and reports each outcome', async () => {
    mockedPost.mockResolvedValue({ status: 200 });
    const { svc } = makeService();

    const outcomes = await svc.deliverToTargets(
      'ws1',
      [target, { id: 'wh2', url: 'https://b.example.com', secret: 's2' }],
      envelope,
    );

    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.status === WebhookDeliveryStatus.SUCCESS)).toBe(true);
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });
});
