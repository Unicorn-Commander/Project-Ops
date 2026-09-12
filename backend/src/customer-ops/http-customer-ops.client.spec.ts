import { ConfigService } from '@nestjs/config';
import { HttpCustomerOpsClient } from './http-customer-ops.client';

/**
 * The read-through client: unconfigured ⇒ inert (no network); configured ⇒
 * the suite service-bearer call carrying Project-Ops' project id (A15), with
 * every failure typed so the panel degrades clean. The token is never logged.
 */
function makeClient(env: Record<string, string | undefined>, fetchImpl?: jest.Mock) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const client = new HttpCustomerOpsClient(config);
  if (fetchImpl) client.useFetch(fetchImpl as any);
  return client;
}

const response = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const req = { quoteId: 'q-0001', projectOpsProjectId: 'p1', workspaceId: 'ws-1' };

describe('HttpCustomerOpsClient', () => {
  it('is inert when unconfigured: UNCONFIGURED, no fetch, a "connect Customer-Ops" message', async () => {
    const fetchImpl = jest.fn();
    const client = makeClient({}, fetchImpl);
    expect(client.isConfigured()).toBe(false);
    const r = await client.getQuoteSummary(req);
    expect(r).toEqual({ ok: false, reason: 'UNCONFIGURED', message: expect.stringMatching(/Connect Customer-Ops/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('needs BOTH the base URL and the service token', () => {
    expect(makeClient({ CUSTOMER_OPS_BASE_URL: 'https://c.test' }).isConfigured()).toBe(false);
    expect(makeClient({ CUSTOMER_OPS_SERVICE_TOKEN: 'tok' }).isConfigured()).toBe(false);
    expect(makeClient({ CUSTOMER_OPS_BASE_URL: 'https://c.test/', CUSTOMER_OPS_SERVICE_TOKEN: 'tok' }).isConfigured()).toBe(true);
  });

  it('calls GET /api/quotes/:id/summary with the Project-Ops project id, the bearer and the workspace hint', async () => {
    const fetchImpl = jest.fn(async () =>
      response(200, {
        quote: {
          id: 'q-0001',
          number: 'Q-2026-0001',
          version: 1,
          title: 'Order Pad for the apparel client',
          status: 'accepted',
          currency: 'USD',
          totals: { one_time_total_cents: 140000, milestone_total_cents: 290000, recurring_monthly_cents: 35000 },
          share_url: 'https://customers.example.dev/q/tok_synthetic',
        },
      }),
    );
    const client = makeClient(
      { CUSTOMER_OPS_BASE_URL: 'https://customers.example.dev/', CUSTOMER_OPS_SERVICE_TOKEN: 'svc-token-value' },
      fetchImpl,
    );

    const r = await client.getQuoteSummary(req);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe('https://customers.example.dev/api/quotes/q-0001/summary?project_ops_project_id=p1');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer svc-token-value');
    expect(init.headers['X-Workspace-Id']).toBe('ws-1');
    expect(init.headers['X-Project-Ops-Project-Id']).toBe('p1');
    expect(init.signal).toBeDefined();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.number).toBe('Q-2026-0001');
      expect(r.summary.totals.one_time_plus_milestones_cents).toBe(430000);
    }
  });

  it('refuses a bare quote id (no project id) without touching the network (A15)', async () => {
    const fetchImpl = jest.fn();
    const client = makeClient({ CUSTOMER_OPS_BASE_URL: 'https://c.test', CUSTOMER_OPS_SERVICE_TOKEN: 't' }, fetchImpl);
    const r = await client.getQuoteSummary({ ...req, projectOpsProjectId: '' });
    expect(r).toMatchObject({ ok: false, reason: 'ERROR' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'DENIED'],
    [403, 'DENIED'],
    [404, 'NOT_FOUND'],
    [500, 'ERROR'],
  ])('maps HTTP %s to %s', async (status, reason) => {
    const client = makeClient(
      { CUSTOMER_OPS_BASE_URL: 'https://c.test', CUSTOMER_OPS_SERVICE_TOKEN: 't' },
      jest.fn(async () => response(status, { error: 'x' })),
    );
    const r = await client.getQuoteSummary(req);
    expect(r).toMatchObject({ ok: false, reason });
  });

  it('maps a network failure / timeout to UNREACHABLE and never throws', async () => {
    const client = makeClient(
      { CUSTOMER_OPS_BASE_URL: 'https://c.test', CUSTOMER_OPS_SERVICE_TOKEN: 't', CUSTOMER_OPS_TIMEOUT_MS: '10' },
      jest.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    await expect(client.getQuoteSummary(req)).resolves.toMatchObject({ ok: false, reason: 'UNREACHABLE' });
  });

  it('treats an unreadable body as ERROR', async () => {
    const client = makeClient(
      { CUSTOMER_OPS_BASE_URL: 'https://c.test', CUSTOMER_OPS_SERVICE_TOKEN: 't' },
      jest.fn(async () => ({ ok: true, status: 200, json: async () => null, text: async () => '' })),
    );
    await expect(client.getQuoteSummary(req)).resolves.toMatchObject({ ok: false, reason: 'ERROR' });
  });
});

describe('HttpCustomerOpsClient — the timeout covers the response BODY (M5)', () => {
  it('aborts a peer that sends headers and then stalls, instead of hanging the panel', async () => {
    jest.useFakeTimers();
    try {
      const client = new HttpCustomerOpsClient({
        get: (k: string) =>
          ({
            CUSTOMER_OPS_BASE_URL: 'https://customers.example.dev',
            CUSTOMER_OPS_SERVICE_TOKEN: 'token-name-only',
            CUSTOMER_OPS_TIMEOUT_MS: '5000',
          })[k],
      } as any);

      // Headers arrive; the body never does — it settles only when the signal aborts.
      client.useFetch((async (_url: string, init: any) => ({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
        text: async () => '',
      })) as any);

      const pending = client.getQuoteSummary({
        quoteId: 'q-0001',
        projectOpsProjectId: 'p1',
        workspaceId: 'ws-1',
      });
      await Promise.resolve();
      jest.advanceTimersByTime(5001);

      const res = await pending;
      // The read failed and degraded cleanly rather than hanging forever.
      expect(res.ok).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
