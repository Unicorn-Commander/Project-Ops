import { User } from '@prisma/client';

/**
 * Suite Identity & Tenancy seam for Project-Ops.
 *
 * Project-Ops has no app-wide multi-tenancy yet (no FORCE-RLS, no session
 * GUC, no workspace registry). The dedicated tenancy effort (PROJ-2026-000023)
 * will add those app-wide. Until then, every new time-tracking row still
 * carries a NOT NULL `workspaceId` so the data is correctly partitioned from
 * the first insert and needs no expensive backfill later.
 *
 * The canonical id is resolved from the validated JWT claim
 * (`workspace_id` → `tenant_id`, never an HTTP header — matching the
 * suite model in Accounting-Ops / Contact-Ops), falling back to a single
 * configured `DEFAULT_WORKSPACE_ID` for today's single-tenant dogfood.
 *
 * When the suite tenancy lands, this is the ONE place that changes: resolve
 * via real workspace membership instead of the env default. The columns,
 * indices, and idempotency keys are already workspace-ready.
 */

// A namespaced, all-zero UUID used only when DEFAULT_WORKSPACE_ID is unset.
// It is a valid UUID so the column stays well-typed; operators should set
// DEFAULT_WORKSPACE_ID explicitly per node.
export const DEFAULT_WORKSPACE_FALLBACK = '00000000-0000-0000-0000-000000000000';

// `User` augmented by JwtStrategy.validate with the validated workspace claim
// (`__workspaceClaim` = the token's `workspace_id`/`tenant_id`) and the acting
// uchub subject (`__ucUid` = the token `sub`, used for `app.uc_uid` attribution
// and as the Membership key). Both are non-persistent, request-scoped only.
//
// A FEDERATION ACTOR principal (a trusted sibling app calling via a Brigade
// token-exchange, e.g. Meeting-Ops → triage ingest) is a SYNTHETIC, non-DB
// principal: `__isFederationActor` is true and `__federationActor` is the
// calling app's id (the Brigade token's `act.client_id`). It is NOT a human
// user, carries no UserRole, and is authorized solely by FederationActorGuard
// (actor allow-list + route scope + the Brigade-vouched `__workspaceClaim`),
// never by a Membership row. A real human token NEVER sets these.
export type WithWorkspaceClaim = User & {
  __workspaceClaim?: string | null;
  __ucUid?: string | null;
  __isFederationActor?: boolean;
  __federationActor?: string | null;
};

/**
 * Resolve the active workspace id for a request/user.
 * Claim (set by JwtStrategy) wins; otherwise the configured default.
 */
export function resolveWorkspaceId(
  user: Partial<WithWorkspaceClaim> | null | undefined,
  defaultWorkspaceId: string,
): string {
  const claim = (user as WithWorkspaceClaim | undefined)?.__workspaceClaim;
  if (typeof claim === 'string' && claim.trim()) {
    return claim.trim();
  }
  return defaultWorkspaceId;
}

/**
 * The acting user's uchub `sub` for `app.uc_uid` attribution. Prefers the
 * validated token `sub` (surfaced as `__ucUid` by JwtStrategy), then the linked
 * `keycloakId`, then the local user id. Always returns a string ('' if none).
 */
export function ucUidOf(
  user: Partial<WithWorkspaceClaim> | null | undefined,
): string {
  const u = user as WithWorkspaceClaim | undefined;
  return (u?.__ucUid?.trim() || u?.keycloakId || u?.id || '') as string;
}

/** The configured default workspace, read from the environment. */
export function defaultWorkspaceId(
  getEnv: (k: string) => string | undefined = (k) => process.env[k],
): string {
  const v = getEnv('DEFAULT_WORKSPACE_ID');
  return v && v.trim() ? v.trim() : DEFAULT_WORKSPACE_FALLBACK;
}

/**
 * The EXPLICIT requested workspace for a request, per the SUITE-IDENTITY §D4
 * addressing precedence — path param `workspaceId`/`workspace_id` then the
 * `X-Workspace-Id` header. Returns null when neither is present (the caller
 * then falls back to the token/PAT/claim-derived workspace). This is the
 * single source of truth for the path>header half of D4 so the JWT guard and
 * the PAT chokepoint can never drift apart.
 */
export function explicitRequestedWorkspaceId(req: {
  params?: Record<string, any>;
  headers?: Record<string, any>;
}): string | null {
  const raw =
    req?.params?.workspaceId ??
    req?.params?.workspace_id ??
    req?.headers?.['x-workspace-id'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
