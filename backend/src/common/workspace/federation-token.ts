/**
 * Shared helpers for federation MACHINE-token proof.
 *
 * Federation write routes (quotes seam, Meeting-Ops triage ingest) must
 * accept only a verified client-credentials / Brigade app-actor token whose
 * azp / client_id / act.client_id is on PROJECT_OPS_FEDERATION_ACTORS, and
 * must reject a human session. JwtStrategy (audience gate), AuthService
 * (principal resolution) and FederationActorGuard (route elevation) share
 * these predicates so the three layers cannot drift.
 */

export const FEDERATION_ACTORS_ENV = 'PROJECT_OPS_FEDERATION_ACTORS';

export const FEDERATION_ACTOR_REQUIRED = 'FEDERATION_ACTOR_REQUIRED';

/** CSV allow-list. Empty / unset ⇒ zero federation trust. */
export function parseFederationActors(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * True when the token represents a human session (browser SSO, on-behalf-of
 * user, or any payload carrying a person identity). Machine client-credentials
 * tokens from Keycloak have no email, no sid / session_state, and a service
 * `sub` (not an email).
 */
export function isHumanSessionPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  if (typeof p.email === 'string' && p.email.includes('@')) return true;
  if (typeof p.sub === 'string' && p.sub.includes('@')) return true;
  if (typeof p.sid === 'string' && p.sid.trim()) return true;
  if (typeof p.session_state === 'string' && p.session_state.trim()) return true;
  return false;
}

/**
 * The calling app's client id, in precedence order:
 *   1. RFC-8693 `act.client_id` (Brigade token-exchange)
 *   2. `azp` (Keycloak authorized party — client-credentials)
 *   3. `client_id` (some Keycloak layouts)
 */
export function readActorClientId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const act = p.act;
  if (act && typeof act === 'object') {
    const cid = (act as Record<string, unknown>).client_id;
    if (typeof cid === 'string' && cid.trim()) return cid.trim();
  }
  if (typeof p.azp === 'string' && p.azp.trim()) return p.azp.trim();
  if (typeof p.client_id === 'string' && p.client_id.trim()) return p.client_id.trim();
  return null;
}

/**
 * A machine federation token: no human session AND an actor client id.
 * Authorization (allow-list + route scope) is FederationActorGuard's job;
 * this only classifies the token so it is not JIT-provisioned as a human.
 */
export function isMachineFederationPayload(payload: unknown): boolean {
  return !isHumanSessionPayload(payload) && readActorClientId(payload) !== null;
}
