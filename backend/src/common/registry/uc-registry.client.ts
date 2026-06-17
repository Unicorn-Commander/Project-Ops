/**
 * uc-registry client — Phase E (SUITE-IDENTITY / phase2-tenancy-blueprint §E).
 *
 * uc-registry is the SUITE source-of-record for workspace identity. PO NEVER
 * mints a workspace id; it picks the canonical id locally and REGISTERS it with
 * uc-registry so the registry and PO's local mirror agree on the same uuid
 * ("supplied = local, so SoR and local agree").
 *
 * THIS STEP (per the runbook, Task #3) is intentionally minimal:
 *   - Flag-gated on UC_REGISTRY_URL. When the env is UNSET the client is a pure
 *     NO-OP and every workspace-creation path behaves EXACTLY as today (dogfood
 *     stays inert — nothing here may change behavior or break boot with the env
 *     unset).
 *   - When set, on each workspace-creation path we POST {UC_REGISTRY_URL}
 *     /workspaces supplying PO's workspace uuid + a stable Idempotency-Key, so a
 *     given workspace is never double-registered (the registry is idempotent on
 *     BOTH the Idempotency-Key header AND a supplied uuid — verified live on
 *     commander).
 *   - We DO NOT implement the lazy-pull mirror-on-cache-miss here; §E scopes
 *     that for the production-flip step, not this one. Do not over-build.
 *
 * FAILURE POLICY (this step): best-effort + LOUD, never fatal. PO supplies the
 * canonical uuid (the local row is authoritative for this step), so a registry
 * outage must not roll back local creation or break a seed/signup. We log a
 * clear error and return a non-throwing result describing the outcome. The HARD
 * GATE in §E — "do not flip prod DATABASE_URL→project_ops_app until every
 * creation path registers" — is a SEPARATE, Aaron-gated cutover (see
 * docs/PHASE-E-PROD-RUNBOOK.md); promoting this to fail-closed belongs there,
 * not in a branch that must stay safe to deploy with tenancy OFF.
 *
 * Implemented with the global `fetch` (Node 18+, used throughout this codebase)
 * + an AbortController timeout, so it works identically in DI services and in
 * the non-DI seed scripts with no new dependency and no NestJS coupling.
 */

/** Default request timeout (ms). Override via UC_REGISTRY_TIMEOUT_MS. */
export const UC_REGISTRY_DEFAULT_TIMEOUT_MS = 5_000;

export type EnvGetter = (key: string) => string | undefined;

const defaultGetter: EnvGetter = (k) => process.env[k];

export interface RegisterWorkspaceInput {
  /** The canonical workspace uuid PO chose locally (uuidv7). Supplied, never minted by the registry. */
  id: string;
  slug: string;
  displayName: string;
  /** 'strict' | 'standard' | 'open' (SUITE-IDENTITY §5). Optional; registry defaults if omitted. */
  isolationMode?: string;
  /** 'shared' | 'premium' | 'enterprise' | 'dedicated'. Optional. */
  isolationTier?: string;
  hipaaMode?: boolean;
  parentWorkspaceId?: string | null;
}

export type RegisterOutcome =
  | { ok: true; skipped: true; reason: 'disabled' } // UC_REGISTRY_URL unset → no-op
  | { ok: true; skipped: false; status: number } // registered (or idempotent hit)
  | { ok: false; reason: 'unreachable' | 'error'; status?: number; message: string };

/** A logging shim so this works with a Nest `Logger`, `console`, or nothing. */
export interface RegistryLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const consoleLogger: RegistryLogger = {
  log: (m) => console.log(`[uc-registry] ${m}`),
  warn: (m) => console.warn(`[uc-registry] ${m}`),
  error: (m) => console.error(`[uc-registry] ${m}`),
};

/** The configured registry base URL, trailing slash trimmed; null when unset. */
export function ucRegistryBaseUrl(getEnv: EnvGetter = defaultGetter): string | null {
  const raw = getEnv('UC_REGISTRY_URL');
  if (!raw || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, '');
}

/** True when the registry client is armed (UC_REGISTRY_URL is set). */
export function ucRegistryEnabled(getEnv: EnvGetter = defaultGetter): boolean {
  return ucRegistryBaseUrl(getEnv) !== null;
}

function timeoutMs(getEnv: EnvGetter): number {
  const raw = getEnv('UC_REGISTRY_TIMEOUT_MS');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : UC_REGISTRY_DEFAULT_TIMEOUT_MS;
}

/**
 * A stable Idempotency-Key for a workspace registration. Deriving it from the
 * (canonical) workspace id means EVERY retry — same process or a later
 * redeploy/seed re-run — sends the SAME key, so the registry never creates a
 * duplicate. (Belt-and-suspenders with the registry's own supplied-uuid
 * idempotency.) Namespaced so it can't collide with another resource's key.
 */
export function workspaceIdempotencyKey(workspaceId: string): string {
  return `project-ops:workspace:${workspaceId}`;
}

/**
 * Register (or idempotently re-assert) a workspace with uc-registry.
 *
 * NO-OP + `{ ok: true, skipped: true }` when UC_REGISTRY_URL is unset — callers
 * can invoke this unconditionally on every creation path and it stays inert on
 * dogfood. Never throws; failures are logged and returned as a result so the
 * caller's local creation is never rolled back by a registry outage in this
 * step.
 */
export async function registerWorkspaceWithRegistry(
  input: RegisterWorkspaceInput,
  opts?: { getEnv?: EnvGetter; logger?: RegistryLogger; fetchImpl?: typeof fetch },
): Promise<RegisterOutcome> {
  const getEnv = opts?.getEnv ?? defaultGetter;
  const logger = opts?.logger ?? consoleLogger;
  const doFetch = opts?.fetchImpl ?? fetch;

  const baseUrl = ucRegistryBaseUrl(getEnv);
  if (!baseUrl) {
    // Inert: env unset → exactly today's behavior (PO's local row stands alone).
    return { ok: true, skipped: true, reason: 'disabled' };
  }

  if (!input.id || !input.id.trim()) {
    // A registration with no supplied id would let the registry MINT one,
    // breaking the "supplied = local" invariant. Refuse loudly rather than
    // desync the SoR from the local mirror.
    const message =
      'refusing to register a workspace with no supplied id (would let the registry mint)';
    logger.error(message);
    return { ok: false, reason: 'error', message };
  }

  const url = `${baseUrl}/workspaces`;
  const idempotencyKey = workspaceIdempotencyKey(input.id);
  const body: Record<string, unknown> = {
    id: input.id, // SUPPLIED canonical uuid — the registry is idempotent on this too.
    slug: input.slug,
    display_name: input.displayName,
    ...(input.isolationMode ? { isolation_mode: input.isolationMode } : {}),
    ...(input.isolationTier ? { isolation_tier: input.isolationTier } : {}),
    ...(input.hipaaMode !== undefined ? { hipaa_mode: input.hipaaMode } : {}),
    ...(input.parentWorkspaceId ? { parent_workspace_id: input.parentWorkspaceId } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(getEnv));
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const message = `uc-registry unreachable at ${url}: ${(err as Error).message}`;
    logger.error(message);
    return { ok: false, reason: 'unreachable', message };
  } finally {
    clearTimeout(timer);
  }

  // 2xx => created or idempotent hit (same uuid / same Idempotency-Key). The
  // registry returns the existing projection on a dup, so anything 2xx is a
  // success for our purposes.
  if (res.ok) {
    logger.log(
      `registered workspace ${input.id} (${input.slug}) with uc-registry (status ${res.status})`,
    );
    return { ok: true, skipped: false, status: res.status };
  }

  const text = await res.text().catch(() => '');
  const message = `uc-registry rejected workspace ${input.id} (status ${res.status}): ${text.slice(0, 300)}`;
  logger.warn(message);
  return { ok: false, reason: 'error', status: res.status, message };
}
