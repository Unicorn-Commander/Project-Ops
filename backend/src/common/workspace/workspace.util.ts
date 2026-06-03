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

// `User` augmented by JwtStrategy.validate with the validated workspace claim.
export type WithWorkspaceClaim = User & { __workspaceClaim?: string | null };

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

/** The configured default workspace, read from the environment. */
export function defaultWorkspaceId(
  getEnv: (k: string) => string | undefined = (k) => process.env[k],
): string {
  const v = getEnv('DEFAULT_WORKSPACE_ID');
  return v && v.trim() ? v.trim() : DEFAULT_WORKSPACE_FALLBACK;
}
