/**
 * Shared helpers for federation MACHINE-token proof.
 *
 * Federation write routes (quotes seam, Meeting-Ops triage ingest) must
 * accept only a verified client-credentials / Brigade app-actor token whose
 * azp / client_id / act.client_id is on PROJECT_OPS_FEDERATION_ACTORS, and
 * must reject a human session. JwtStrategy (audience gate), AuthService
 * (principal resolution) and FederationActorGuard (route elevation) share
 * these predicates so the three layers cannot drift.
 *
 * HOW EACH REAL CALLER PRESENTS (actor = readActorClientId's result):
 *
 *   | caller / route              | token            | actor claim            | actor value    |
 *   |-----------------------------|------------------|------------------------|----------------|
 *   | Customer-Ops → quotes       | Brigade exchange | `act.client_id`        | `customer-ops` |
 *   | Meeting-Ops → triage/ingest | Brigade exchange | `act.client_id`        | `meeting-ops`  |
 *   | Meeting-Ops → direct tasks  | Keycloak CC      | `azp` (= `project-ops`)| `project-ops`  |
 *
 * The first two are Brigade RFC-8693 tokens (`aud=project-ops`); the actor is
 * the nested `act.client_id`. The third is the Meeting-Ops bridge's older
 * direct task-create path, which mints a Keycloak `client_credentials` token
 * from the `project-ops` client (azp=`project-ops`). After the L2c machine
 * classification this token is a MACHINE actor `project-ops` — NOT a human
 * `bridge@…` session and NOT on the federation allow-list — so the direct
 * `/tasks` human-role route will stop accepting it and the bridge must migrate
 * to the Brigade `triage/ingest` path (actor `meeting-ops`, allow-listed).
 * `readActorClientId` prefers `act.client_id`, then `azp`, then `client_id`, so
 * a Brigade exchange always resolves the CALLING app, while a bare Keycloak
 * service-account token resolves its own client.
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
 * True when the payload is a Keycloak SERVICE-ACCOUNT (`client_credentials`)
 * token. In the uchub realm these tokens STILL carry an email (the service
 * account's configured email) + `email_verified` + `name`/`given_name`/
 * `family_name`, so **email absence can NEVER be a machine signal**. The
 * reliable machine markers are instead:
 *   - `preferred_username` prefixed `service-account-` (Keycloak's convention),
 *   - the `clientHost` claim (stamped only on client_credentials tokens — the
 *     host the grant was requested from; a human SSO token never carries it),
 *   - a `client_id` claim with NO `sid` / `session_state` (browser SSO tokens
 *     carry `azp` + `sid`/`session_state`, not `client_id`).
 */
export function isKeycloakServiceAccountPayload(payload: Record<string, unknown>): boolean {
  // Session claims win over service-account-looking profile fields. A signed
  // token with conflicting claims must never gain machine-only privileges.
  const hasSession =
    (typeof payload.sid === 'string' && payload.sid.trim()) ||
    (typeof payload.session_state === 'string' && payload.session_state.trim());
  if (hasSession) return false;
  const pu = payload.preferred_username;
  if (typeof pu === 'string' && pu.trim().startsWith('service-account-')) return true;
  if (typeof payload.clientHost === 'string' && payload.clientHost.trim()) return true;
  return typeof payload.client_id === 'string' && payload.client_id.trim() !== '';
}

/**
 * True when the token represents a human session (browser SSO, on-behalf-of
 * user). A Keycloak SERVICE-ACCOUNT token is NOT a human session even though
 * uchub stamps an email on it (see `isKeycloakServiceAccountPayload`) — this
 * is the L2c fix: classify by service-account markers, never by email.
 */
export function isHumanSessionPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;

  // Machine tokens first: a Keycloak service-account token carries an email in
  // uchub, so it must be excluded BEFORE any email/sub human signal is read.
  if (isKeycloakServiceAccountPayload(p)) return false;

  // Definitive human-session markers (absent from service-account and Brigade
  // machine tokens).
  if (typeof p.sid === 'string' && p.sid.trim()) return true;
  if (typeof p.session_state === 'string' && p.session_state.trim()) return true;

  // Fallback identity signals (a genuine human email/sub). Never consulted for
  // service-account tokens (already excluded above).
  if (typeof p.email === 'string' && p.email.includes('@')) return true;
  if (typeof p.sub === 'string' && p.sub.includes('@')) return true;
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
