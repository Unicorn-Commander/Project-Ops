/**
 * Ops-Center entitlements client — the launch-gate entitlement check.
 *
 * Ops-Center exposes a token-accepting endpoint at {UC_ENTITLEMENTS_URL} which
 * accepts the user's uchub Keycloak **Bearer** and returns the caller's org
 * entitlements:
 *
 *   GET {UC_ENTITLEMENTS_URL}        Authorization: Bearer <uchub access token>
 *   200 -> { "org_id": "...", "tier": "managed", "role": "owner",
 *            "entitlements": ["project_ops_access", ...] }
 *
 * PO allows sign-in iff PROJECT_OPS_FEATURE_KEY (default "project_ops_access")
 * is present in `entitlements`, and seeds the JIT role from `role`
 * (owner -> ADMIN, everything else -> STAFF). MANAGER/CLIENT are refined in-app
 * and are NEVER auto-assigned from here (CLIENT in particular is reserved for
 * portal-invited, non-Keycloak users). This REPLACES the static
 * PROJECT_OPS_ACCESS_LIST gate when armed.
 *
 * ARMED only when PROJECT_OPS_ENTITLEMENTS_ENABLED is truthy AND
 * UC_ENTITLEMENTS_URL is set. Unset / not-enabled -> NOT armed -> the caller
 * keeps the legacy allowlist behavior, so this is safe to ship dark (flag OFF)
 * and a misconfigured "enabled-but-no-URL" deploy fails safe to the allowlist
 * rather than locking everyone out.
 *
 * Per the UC dev (2026-06-25): re-check on EVERY interactive SSO login (this is
 * invoked from KeycloakStrategy.validate, the browser login, with that login's
 * fresh uchub Bearer), so a revoked entitlement (plan change / cancellation)
 * actually locks a previously-provisioned user out. A short per-user cache
 * (~60s) collapses duplicate checks within a single login burst.
 *
 * FAILURE POLICY: a DEFINITIVE endpoint verdict governs — 200 allows/denies by
 * key presence; 401/403 denies. An INDETERMINATE failure (network / timeout /
 * 5xx / unparseable) returns `indeterminate`; the CALLER decides fail-closed
 * (deny) vs. degrade-to-allowlist, per PROJECT_OPS_ENTITLEMENTS_FAIL_OPEN. This
 * mirrors uc-registry.client.ts: never throw, return a result.
 *
 * Implemented with the global `fetch` (Node 18+, used throughout this codebase)
 * + an AbortController timeout, with injectable getEnv/fetchImpl/logger so it is
 * trivially unit-testable and has no NestJS coupling.
 */

import { UserRole } from '@prisma/client';

/** Default request timeout (ms). Override via UC_ENTITLEMENTS_TIMEOUT_MS. */
export const UC_ENTITLEMENTS_DEFAULT_TIMEOUT_MS = 5_000;

/** The entitlement key that grants Project-Ops access. Override via PROJECT_OPS_FEATURE_KEY. */
export const DEFAULT_PROJECT_OPS_FEATURE_KEY = 'project_ops_access';

export type EnvGetter = (key: string) => string | undefined;

const defaultGetter: EnvGetter = (k) => process.env[k];

/** A logging shim so this works with a Nest `Logger`, `console`, or nothing. */
export interface EntitlementsLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

const consoleLogger: EntitlementsLogger = {
  log: (m) => console.log(`[entitlements] ${m}`),
  warn: (m) => console.warn(`[entitlements] ${m}`),
  error: (m) => console.error(`[entitlements] ${m}`),
};

export interface EntitlementResolution {
  /**
   * `allowed`  — a 200 whose entitlements include PROJECT_OPS_FEATURE_KEY.
   * `denied`   — a definitive no: 200 without the key, or a 401/403 token reject.
   * `indeterminate` — could not get a verdict (unset URL, no token, network /
   *                   timeout / 5xx / unparseable). The caller resolves this.
   */
  outcome: 'allowed' | 'denied' | 'indeterminate';
  /** The mapped Project-Ops JIT role when `allowed`; null otherwise. */
  role: UserRole | null;
  orgId: string | null;
  tier: string | null;
  reason: string;
}

/** The configured entitlements endpoint URL, trailing slash trimmed; null when unset. */
export function ucEntitlementsUrl(getEnv: EnvGetter = defaultGetter): string | null {
  const raw = getEnv('UC_ENTITLEMENTS_URL');
  if (!raw || !raw.trim()) return null;
  return raw.trim().replace(/\/+$/, '');
}

/** The entitlement key Project-Ops gates on (default "project_ops_access"). */
export function projectOpsFeatureKey(getEnv: EnvGetter = defaultGetter): string {
  const raw = getEnv('PROJECT_OPS_FEATURE_KEY');
  return raw && raw.trim() ? raw.trim() : DEFAULT_PROJECT_OPS_FEATURE_KEY;
}

function truthy(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * True when the entitlements gate is ARMED: the flag is on AND a URL is set.
 * Requiring BOTH means an "enabled-but-no-URL" misconfig stays inert (the caller
 * keeps the allowlist) instead of failing every login.
 */
export function entitlementsEnabled(getEnv: EnvGetter = defaultGetter): boolean {
  return truthy(getEnv('PROJECT_OPS_ENTITLEMENTS_ENABLED')) && ucEntitlementsUrl(getEnv) !== null;
}

/**
 * On an INDETERMINATE entitlements result, whether to degrade to the legacy
 * allowlist (true) or fail closed / deny (false, the default — this is a
 * security gate, so an Ops-Center outage must not silently admit everyone).
 */
export function entitlementsFailOpen(getEnv: EnvGetter = defaultGetter): boolean {
  return truthy(getEnv('PROJECT_OPS_ENTITLEMENTS_FAIL_OPEN'));
}

/**
 * "Soft enforce" — on a DEFINITIVE deny (a 200 whose entitlements omit the key,
 * or a 401/403 token reject), whether to fall back to the legacy allowlist and
 * grandfather allowlisted users in (true), or hard-deny (false, the default —
 * pure enforce).
 *
 * This is the seed-then-enforce MIGRATION tool: while Ops-Center orgs are still
 * being seeded with entitlements, turning this on means a known-good allowlist
 * user is never locked out by an unseeded org, while the gate still enforces
 * entitlements for everyone NOT on the allowlist. Remove (set false) once every
 * intended org is seeded, to land on pure entitlement enforcement.
 */
export function entitlementsAllowlistFallback(getEnv: EnvGetter = defaultGetter): boolean {
  return truthy(getEnv('PROJECT_OPS_ENTITLEMENTS_ALLOWLIST_FALLBACK'));
}

function timeoutMs(getEnv: EnvGetter): number {
  const raw = getEnv('UC_ENTITLEMENTS_TIMEOUT_MS');
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : UC_ENTITLEMENTS_DEFAULT_TIMEOUT_MS;
}

/**
 * Map the Ops-Center org membership role to a Project-Ops JIT role.
 * `owner` -> ADMIN; everything else (admin / billing_admin / member / unknown)
 * -> STAFF. Deliberately never returns MANAGER or CLIENT: those are refined
 * in-app, and CLIENT is reserved for portal-invited non-Keycloak users.
 */
export function mapEntitlementRole(role: string | null | undefined): UserRole {
  return (role ?? '').trim().toLowerCase() === 'owner' ? UserRole.ADMIN : UserRole.STAFF;
}

/**
 * Resolve the caller's Project-Ops entitlement by forwarding their uchub Bearer
 * to the Ops-Center entitlements endpoint. Never throws — returns a result.
 *
 * `indeterminate` is returned (not an exception) for every non-verdict case so
 * the caller can apply its fail-open/closed policy uniformly.
 */
export async function resolveEntitlement(
  accessToken: string | undefined,
  opts?: { getEnv?: EnvGetter; logger?: EntitlementsLogger; fetchImpl?: typeof fetch },
): Promise<EntitlementResolution> {
  const getEnv = opts?.getEnv ?? defaultGetter;
  const logger = opts?.logger ?? consoleLogger;
  const doFetch = opts?.fetchImpl ?? fetch;

  const url = ucEntitlementsUrl(getEnv);
  if (!url) {
    return {
      outcome: 'indeterminate',
      role: null,
      orgId: null,
      tier: null,
      reason: 'UC_ENTITLEMENTS_URL unset',
    };
  }
  if (!accessToken || !accessToken.trim()) {
    // No uchub Bearer to forward (e.g. the realm-token-direct-to-API or
    // Brigade-federated caller — a documented fast-follow). Caller falls back.
    return {
      outcome: 'indeterminate',
      role: null,
      orgId: null,
      tier: null,
      reason: 'no bearer token to forward',
    };
  }

  const featureKey = projectOpsFeatureKey(getEnv);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs(getEnv));
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      signal: controller.signal,
    });
  } catch (err) {
    const reason = `entitlements endpoint unreachable at ${url}: ${(err as Error).message}`;
    logger.warn(reason);
    return { outcome: 'indeterminate', role: null, orgId: null, tier: null, reason };
  } finally {
    clearTimeout(timer);
  }

  // A token the endpoint rejects is a DEFINITIVE deny, not an outage.
  if (res.status === 401 || res.status === 403) {
    return {
      outcome: 'denied',
      role: null,
      orgId: null,
      tier: null,
      reason: `entitlements endpoint rejected token (status ${res.status})`,
    };
  }
  if (!res.ok) {
    const reason = `entitlements endpoint error (status ${res.status})`;
    logger.warn(reason);
    return { outcome: 'indeterminate', role: null, orgId: null, tier: null, reason };
  }

  let body: any;
  try {
    body = await res.json();
  } catch (err) {
    const reason = `entitlements response not JSON: ${(err as Error).message}`;
    logger.warn(reason);
    return { outcome: 'indeterminate', role: null, orgId: null, tier: null, reason };
  }

  // Tolerant extraction — the spec described the list as both `feature_keys`
  // (first message) and `entitlements` (the concrete JSON example), and an
  // envelope may nest it under `data`. Accept any of those so a field-name
  // wording difference can't masquerade as a (definitive) deny.
  const { field: matchedField, list: entitlements } = extractEntitlementList(body);
  // Observability for the auth gate: which field carried the list + the raw
  // top-level keys + the verdict. NOTE: this app's request-time logs do not
  // currently surface in container logs (Sentry's Express-layer instrumentation
  // + a failing winston file-sink — tracked separately); this is the correct
  // channel for when that's fixed.
  logger.log(
    `decision: status=${res.status} matchedField=${matchedField ?? 'NONE'} ` +
      `topKeys=[${Object.keys(body ?? {}).join(',')}] count=${entitlements.length} ` +
      `has('${featureKey}')=${entitlements.includes(featureKey)}`,
  );
  const role = body?.role ?? body?.data?.role;
  const orgId =
    typeof body?.org_id === 'string'
      ? body.org_id
      : typeof body?.data?.org_id === 'string'
        ? body.data.org_id
        : null;
  const tier =
    typeof body?.tier === 'string'
      ? body.tier
      : typeof body?.data?.tier === 'string'
        ? body.data.tier
        : null;

  if (!entitlements.includes(featureKey)) {
    // Diagnostic: surface the status + which top-level keys the endpoint
    // returned, so a missing-entitlement vs unexpected-shape is distinguishable
    // in the logs without a code change.
    const reason = `org lacks '${featureKey}' entitlement (status ${res.status}; keys=[${Object.keys(
      body ?? {},
    ).join(',')}]; found=[${entitlements.join(',') || 'none'}])`;
    logger.warn(reason);
    return { outcome: 'denied', role: null, orgId, tier, reason };
  }

  return {
    outcome: 'allowed',
    role: mapEntitlementRole(role),
    orgId,
    tier,
    reason: `entitled via '${featureKey}' (org role=${role ?? 'n/a'}, tier=${tier ?? 'n/a'})`,
  };
}

/**
 * Pull the entitlement-string list out of the response, tolerating the field
 * being named `entitlements` or `feature_keys`, optionally nested under `data`.
 * Returns [] when none of those are present (-> caller denies).
 */
function extractEntitlementList(body: any): { field: string | null; list: string[] } {
  const candidates: Array<[string, unknown]> = [
    ['entitlements', body?.entitlements],
    ['feature_keys', body?.feature_keys],
    ['featureKeys', body?.featureKeys],
    ['data.entitlements', body?.data?.entitlements],
    ['data.feature_keys', body?.data?.feature_keys],
  ];
  for (const [field, c] of candidates) {
    if (Array.isArray(c)) return { field, list: c.map((e: unknown) => String(e)) };
  }
  return { field: null, list: [] };
}
