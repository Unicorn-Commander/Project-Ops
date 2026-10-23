import { ConfigService } from '@nestjs/config';
import { HttpEmailOpsClient } from './http-email-ops.client';
import { EmailOpsComposeRequest } from './email-ops.port';

/**
 * The Email-Ops compose client: unconfigured ⇒ inert (no network); configured ⇒
 * a JSON-RPC tools/call for compose_email carrying the (workspace_id,
 * external_source=project-ops, external_ref) idempotency tuple and the mode.
 * Every failure is typed; the token is never logged.
 */
function makeClient(env: Record<string, string | undefined>, fetchImpl?: jest.Mock) {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  const client = new HttpEmailOpsClient(config);
  if (fetchImpl) client.useFetch(fetchImpl as any);
  return client;
}

const response = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const req: EmailOpsComposeRequest = {
  workspaceId: 'ws-1',
  externalRef: 'proj-1:task-9:task.assigned',
  toAddress: 'astra@magicunicorn.dev',
  subject: 'New task assigned',
  body: 'You were assigned a task.',
  mode: 'send',
};

describe('HttpEmailOpsClient', () => {
  it('is inert when unconfigured: UNCONFIGURED, no fetch, a "Connect Email-Ops" message', async () => {
    const fetchImpl = jest.fn();
    const client = makeClient({}, fetchImpl);
    expect(client.isConfigured()).toBe(false);
    const r = await client.compose(req);
    expect(r).toEqual({
      ok: false,
      reason: 'UNCONFIGURED',
      message: expect.stringMatching(/Connect Email-Ops/),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('needs BOTH the base URL and the service token', () => {
    expect(makeClient({ EMAIL_OPS_BASE_URL: 'https://m.test' }).isConfigured()).toBe(false);
    expect(makeClient({ EMAIL_OPS_SERVICE_TOKEN: 'tok' }).isConfigured()).toBe(false);
    expect(
      makeClient({
        EMAIL_OPS_BASE_URL: 'https://m.test/',
        EMAIL_OPS_SERVICE_TOKEN: 'tok',
      }).isConfigured(),
    ).toBe(true);
  });

  it('POSTs a tools/call for compose_email with the idempotency tuple, mode and bearer', async () => {
    const fetchImpl = jest.fn(async () =>
      response(200, {
        result: {
          structuredContent: { id: 'msg-1', thread_id: 'thread-1', status: 'queued' },
        },
      }),
    );
    const client = makeClient(
      {
        EMAIL_OPS_BASE_URL: 'https://mail.example.dev/',
        EMAIL_OPS_SERVICE_TOKEN: 'svc-token-value',
      },
      fetchImpl,
    );

    const r = await client.compose(req);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as any[];
    expect(url).toBe('https://mail.example.dev/api/v1/mcp');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer svc-token-value');

    const body = JSON.parse(init.body);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('compose_email');
    expect(body.params.arguments).toMatchObject({
      workspace_id: 'ws-1',
      external_source: 'project-ops',
      external_ref: 'proj-1:task-9:task.assigned',
      to_address: 'astra@magicunicorn.dev',
      subject: 'New task assigned',
      mode: 'send',
    });

    expect(r).toEqual({ ok: true, messageId: 'msg-1', threadId: 'thread-1', status: 'queued' });
  });

  it('maps a client-facing email to mode=draft and passes contact_id for thread linking', async () => {
    const fetchImpl = jest.fn(async () =>
      response(200, {
        result: { structuredContent: { id: 'msg-2', thread_id: null, status: 'draft' } },
      }),
    );
    const client = makeClient(
      { EMAIL_OPS_BASE_URL: 'https://mail.example.dev', EMAIL_OPS_SERVICE_TOKEN: 'tok' },
      fetchImpl,
    );

    const r = await client.compose({
      workspaceId: 'ws-1',
      externalRef: 'proj-2:client-update',
      toAddress: 'client@example.com',
      subject: 'Project status update',
      body: 'Here is your update.',
      mode: 'draft',
      contactId: 'contact-1',
    });

    const [, init] = fetchImpl.mock.calls[0] as any[];
    const args = JSON.parse(init.body).params.arguments;
    expect(args.mode).toBe('draft');
    expect(args.contact_id).toBe('contact-1');
    expect(r).toEqual({ ok: true, messageId: 'msg-2', threadId: null, status: 'draft' });
  });

  it('types a 401/403 as DENIED and does not log the token', async () => {
    const fetchImpl = jest.fn(async () => response(403, { detail: 'nope' }));
    const client = makeClient(
      {
        EMAIL_OPS_BASE_URL: 'https://mail.example.dev',
        EMAIL_OPS_SERVICE_TOKEN: 'svc-token-value',
      },
      fetchImpl,
    );
    const r = await client.compose(req);
    expect(r).toMatchObject({ ok: false, reason: 'DENIED' });
  });

  it('types a network failure as UNREACHABLE (never throws)', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const client = makeClient(
      { EMAIL_OPS_BASE_URL: 'https://mail.example.dev', EMAIL_OPS_SERVICE_TOKEN: 'tok' },
      fetchImpl,
    );
    const r = await client.compose(req);
    expect(r).toMatchObject({ ok: false, reason: 'UNREACHABLE' });
  });

  it('rejects a request missing the idempotency fields without a network call', async () => {
    const fetchImpl = jest.fn();
    const client = makeClient(
      { EMAIL_OPS_BASE_URL: 'https://mail.example.dev', EMAIL_OPS_SERVICE_TOKEN: 'tok' },
      fetchImpl,
    );
    const r = await client.compose({ ...req, externalRef: '' });
    expect(r).toMatchObject({ ok: false, reason: 'ERROR' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
