import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WebhookDeliveryStatus } from '@prisma/client';
import { WebhooksService } from './webhooks.service';

/**
 * Unit tests for WebhooksService. The workspace chokepoint is mocked to invoke
 * the callback with a fake tx (mirroring comments.service.spec) so we exercise
 * the service's validation, secret handling, and event-matching logic without a
 * DB.
 */
function makeService(tx: any) {
  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
    runInWorkspace: jest.fn(async (_ws: string, _uid: any, fn: (t: any) => any) => fn(tx)),
  };
  const delivery = { deliver: jest.fn(), deliverToTargets: jest.fn() };
  const svc = new WebhooksService(workspaceContext as any, delivery as any);
  return { svc, workspaceContext, delivery };
}

const user = { id: 'u1', email: 'a@x.co', keycloakId: 'kc1' } as any;

const endpointRow = (over: Partial<any> = {}) => ({
  id: 'wh1',
  workspaceId: 'ws1',
  url: 'https://hooks.example.com/in',
  secret: 'whsec_000000000000',
  events: ['task.created'],
  enabled: true,
  description: null,
  createdById: 'u1',
  createdAt: new Date('2026-06-18T00:00:00Z'),
  updatedAt: new Date('2026-06-18T00:00:00Z'),
  ...over,
});

describe('WebhooksService.create', () => {
  it('generates a secret, returns it ONCE, and never leaks it in the masked shape', async () => {
    const create = jest.fn(async ({ data }: any) =>
      endpointRow({ secret: data.secret, events: data.events }),
    );
    const { svc } = makeService({ webhookEndpoint: { create } });

    const res = await svc.create('ws1', user, {
      url: 'https://hooks.example.com/in',
      events: ['task.created', 'task.completed'],
    });

    // Secret returned once on create.
    expect(res.secret).toBeDefined();
    expect(res.secret.startsWith('whsec_')).toBe(true);
    // Masked hint is the last 4 chars, never the full secret.
    expect(res.secretHint).toBe(`…${res.secret.slice(-4)}`);
    expect((res as any).secret).not.toEqual(res.secretHint);
    // Persisted with enabled default + creator.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: 'ws1', enabled: true, createdById: 'u1' }),
      }),
    );
  });

  it('dedupes requested events', async () => {
    const create = jest.fn(async ({ data }: any) => endpointRow({ events: data.events }));
    const { svc } = makeService({ webhookEndpoint: { create } });

    await svc.create('ws1', user, {
      url: 'https://h.example.com',
      events: ['task.created', 'task.created', 'task.completed'],
    });

    expect(create.mock.calls[0][0].data.events).toEqual(['task.created', 'task.completed']);
  });

  it('rejects an unknown event with 400', async () => {
    const { svc } = makeService({ webhookEndpoint: { create: jest.fn() } });
    await expect(
      svc.create('ws1', user, {
        url: 'https://h.example.com',
        events: ['task.created', 'bogus.event'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects plain http to a non-loopback host', async () => {
    const { svc } = makeService({ webhookEndpoint: { create: jest.fn() } });
    await expect(
      svc.create('ws1', user, { url: 'http://hooks.example.com/in', events: ['task.created'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows http for localhost dev receivers', async () => {
    const create = jest.fn(async ({ data }: any) => endpointRow({ url: data.url }));
    const { svc } = makeService({ webhookEndpoint: { create } });
    await expect(
      svc.create('ws1', user, { url: 'http://localhost:4000/hook', events: ['task.created'] }),
    ).resolves.toBeDefined();
  });
});

describe('WebhooksService.update', () => {
  it('rotates the secret and returns the NEW one once', async () => {
    const findUnique = jest.fn(async () => endpointRow());
    const update = jest.fn(async ({ data }: any) => endpointRow({ secret: data.secret }));
    const { svc } = makeService({ webhookEndpoint: { findUnique, update } });

    const res = (await svc.update('ws1', user, 'wh1', { rotateSecret: true })) as any;

    expect(res.secret).toBeDefined();
    expect(res.secret).not.toBe('whsec_000000000000');
    expect(update.mock.calls[0][0].data.secret).toBe(res.secret);
  });

  it('does NOT return a secret on a normal update', async () => {
    const findUnique = jest.fn(async () => endpointRow());
    const update = jest.fn(async () => endpointRow({ enabled: false }));
    const { svc } = makeService({ webhookEndpoint: { findUnique, update } });

    const res = (await svc.update('ws1', user, 'wh1', { enabled: false })) as any;
    expect(res.secret).toBeUndefined();
    expect(res.secretHint).toBeDefined();
  });

  it('404s when the endpoint is not in the workspace', async () => {
    const findUnique = jest.fn(async () => null);
    const { svc } = makeService({ webhookEndpoint: { findUnique, update: jest.fn() } });
    await expect(svc.update('ws1', user, 'missing', { enabled: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('WebhooksService.findEnabledTargetsForEvent', () => {
  it('queries enabled endpoints whose events[] contains the event and maps to targets', async () => {
    const findMany = jest.fn(async () => [
      { id: 'wh1', url: 'https://a.example.com', secret: 's1' },
      { id: 'wh2', url: 'https://b.example.com', secret: 's2' },
    ]);
    const { svc } = makeService({ webhookEndpoint: { findMany } });

    const targets = await svc.findEnabledTargetsForEvent('ws1', 'task.created');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { enabled: true, events: { has: 'task.created' } },
        select: { id: true, url: true, secret: true },
      }),
    );
    expect(targets).toEqual([
      { id: 'wh1', url: 'https://a.example.com', secret: 's1' },
      { id: 'wh2', url: 'https://b.example.com', secret: 's2' },
    ]);
  });

  it('returns [] when no endpoint subscribes to the event', async () => {
    const { svc } = makeService({ webhookEndpoint: { findMany: jest.fn(async () => []) } });
    expect(await svc.findEnabledTargetsForEvent('ws1', 'task.completed')).toEqual([]);
  });
});

describe('WebhooksService.sendTest', () => {
  it('dispatches a signed ping through the delivery engine', async () => {
    const findUnique = jest.fn(async () => endpointRow());
    const { svc, delivery } = makeService({ webhookEndpoint: { findUnique } });
    (delivery.deliver as jest.Mock).mockResolvedValue({
      deliveryId: 'd1',
      status: WebhookDeliveryStatus.SUCCESS,
      responseCode: 200,
      attempts: 1,
    });

    const res = await svc.sendTest('ws1', user, 'wh1');

    expect(delivery.deliver).toHaveBeenCalledWith(
      'ws1',
      { id: 'wh1', url: 'https://hooks.example.com/in', secret: 'whsec_000000000000' },
      expect.objectContaining({ event: 'ping', workspaceId: 'ws1' }),
    );
    expect(res).toEqual({ deliveryId: 'd1', status: WebhookDeliveryStatus.SUCCESS });
  });
});

describe('WebhooksService.list', () => {
  it('never returns a raw secret', async () => {
    const findMany = jest.fn(async () => [
      endpointRow(),
      endpointRow({ id: 'wh2', secret: 'whsec_000000000000' }),
    ]);
    const { svc } = makeService({ webhookEndpoint: { findMany } });

    const rows = await svc.list('ws1', user);
    for (const r of rows) {
      expect((r as any).secret).toBeUndefined();
      expect(r.secretHint.startsWith('…')).toBe(true);
    }
  });
});
