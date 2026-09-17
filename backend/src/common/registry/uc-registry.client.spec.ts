/**
 * Unit tests for the uc-registry client (Phase E).
 *
 * Pins the contract that matters for safety:
 *   - NO-OP when UC_REGISTRY_URL is unset (dogfood/default stays inert).
 *   - When set: POSTs to {URL}/workspaces with the SUPPLIED uuid in the body and
 *     a stable Idempotency-Key header.
 *   - Idempotent retry: the SAME workspace id yields the SAME Idempotency-Key on
 *     every call (so the registry never dups).
 *   - Best-effort failure policy: unreachable / non-2xx never throws; returns a
 *     descriptive non-ok result so a registry outage can't break local creation.
 *   - Refuses to register with no supplied id (would let the registry mint).
 */
import {
  registerWorkspaceWithRegistry,
  ucRegistryEnabled,
  ucRegistryBaseUrl,
  workspaceIdempotencyKey,
  RegistryLogger,
} from './uc-registry.client';

const WS = {
  id: '019e50a3-d995-723f-ab66-0f765f92c0f4',
  slug: 'magic-unicorn',
  displayName: 'Magic Unicorn',
  isolationMode: 'standard',
  isolationTier: 'shared',
};

const silentLogger: RegistryLogger = { log: () => {}, warn: () => {}, error: () => {} };

/** An env getter backed by a plain object. */
const env = (vars: Record<string, string>) => (k: string) => vars[k];

describe('uc-registry client', () => {
  describe('configuration helpers', () => {
    it('is disabled (no base url) when UC_REGISTRY_URL is unset', () => {
      expect(ucRegistryEnabled(env({}))).toBe(false);
      expect(ucRegistryBaseUrl(env({}))).toBeNull();
      expect(ucRegistryEnabled(env({ UC_REGISTRY_URL: '   ' }))).toBe(false);
    });

    it('trims a trailing slash from the base url', () => {
      expect(ucRegistryBaseUrl(env({ UC_REGISTRY_URL: 'http://r:8081/' }))).toBe('http://r:8081');
      expect(ucRegistryBaseUrl(env({ UC_REGISTRY_URL: 'http://r:8081///' }))).toBe('http://r:8081');
    });

    it('derives a stable, namespaced Idempotency-Key from the workspace id', () => {
      expect(workspaceIdempotencyKey(WS.id)).toBe(`project-ops:workspace:${WS.id}`);
      // Stable across calls (same input -> same key).
      expect(workspaceIdempotencyKey(WS.id)).toBe(workspaceIdempotencyKey(WS.id));
    });
  });

  describe('registerWorkspaceWithRegistry', () => {
    it('is a NO-OP when UC_REGISTRY_URL is unset (never calls fetch)', async () => {
      const fetchImpl = jest.fn();
      const outcome = await registerWorkspaceWithRegistry(WS, {
        getEnv: env({}),
        logger: silentLogger,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(outcome).toEqual({ ok: true, skipped: true, reason: 'disabled' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('POSTs the supplied uuid + Idempotency-Key when UC_REGISTRY_URL is set', async () => {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ id: WS.id }), { status: 201 }));
      const outcome = await registerWorkspaceWithRegistry(WS, {
        getEnv: env({ UC_REGISTRY_URL: 'http://registry:8081' }),
        logger: silentLogger,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      expect(outcome).toEqual({ ok: true, skipped: false, status: 201 });
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe('http://registry:8081/workspaces');
      expect(init.method).toBe('POST');
      expect(init.headers['Idempotency-Key']).toBe(`project-ops:workspace:${WS.id}`);
      expect(init.headers['Content-Type']).toBe('application/json');
      // The SUPPLIED canonical uuid must be in the body (PO never lets the
      // registry mint), alongside the snake_cased projection fields.
      const body = JSON.parse(init.body);
      expect(body.id).toBe(WS.id);
      expect(body.slug).toBe(WS.slug);
      expect(body.display_name).toBe(WS.displayName);
      expect(body.isolation_mode).toBe('standard');
      expect(body.isolation_tier).toBe('shared');
    });

    it('treats any 2xx (incl. an idempotent dup hit) as success', async () => {
      // The registry returns the existing projection (200) on a supplied-uuid
      // / Idempotency-Key dup — that is success for us.
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ id: WS.id, existing: true }), { status: 200 }),
        );
      const outcome = await registerWorkspaceWithRegistry(WS, {
        getEnv: env({ UC_REGISTRY_URL: 'http://registry:8081' }),
        logger: silentLogger,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(outcome).toEqual({ ok: true, skipped: false, status: 200 });
    });

    it('idempotent retry: the same id sends the same Idempotency-Key both times', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response('{}', { status: 201 }));
      const opts = {
        getEnv: env({ UC_REGISTRY_URL: 'http://registry:8081' }),
        logger: silentLogger,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      };
      await registerWorkspaceWithRegistry(WS, opts);
      await registerWorkspaceWithRegistry(WS, opts); // retry

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const key1 = fetchImpl.mock.calls[0][1].headers['Idempotency-Key'];
      const key2 = fetchImpl.mock.calls[1][1].headers['Idempotency-Key'];
      expect(key1).toBe(key2);
      expect(key1).toBe(`project-ops:workspace:${WS.id}`);
    });

    it('best-effort: an unreachable registry returns a non-ok result and does NOT throw', async () => {
      const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const errors: string[] = [];
      const outcome = await registerWorkspaceWithRegistry(WS, {
        getEnv: env({ UC_REGISTRY_URL: 'http://registry:8081' }),
        logger: { ...silentLogger, error: (m) => errors.push(m) },
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe('unreachable');
      expect(errors.length).toBe(1); // logged loudly
    });

    it('best-effort: a non-2xx response returns a non-ok result and does NOT throw', async () => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response('boom', { status: 500 }));
      const outcome = await registerWorkspaceWithRegistry(WS, {
        getEnv: env({ UC_REGISTRY_URL: 'http://registry:8081' }),
        logger: silentLogger,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.reason).toBe('error');
        expect(outcome.status).toBe(500);
      }
    });

    it('refuses to register with no supplied id (would let the registry mint)', async () => {
      const fetchImpl = jest.fn();
      const outcome = await registerWorkspaceWithRegistry(
        { ...WS, id: '' },
        {
          getEnv: env({ UC_REGISTRY_URL: 'http://registry:8081' }),
          logger: silentLogger,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      );
      expect(outcome.ok).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('aborts on timeout (UC_REGISTRY_TIMEOUT_MS) and reports unreachable', async () => {
      // fetch that rejects when its signal aborts (mimics undici's AbortError).
      const fetchImpl = jest.fn(
        (_url: string, init: any) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(new Error('The operation was aborted')),
            );
          }),
      );
      const outcome = await registerWorkspaceWithRegistry(WS, {
        getEnv: env({ UC_REGISTRY_URL: 'http://registry:8081', UC_REGISTRY_TIMEOUT_MS: '5' }),
        logger: silentLogger,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe('unreachable');
    });
  });
});
