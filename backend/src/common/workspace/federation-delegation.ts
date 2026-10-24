/**
 * ON-BEHALF-OF delegation for federation READS (task 092b2902, P-00177).
 *
 * Customer-Ops reads Project-Ops through a Brigade RFC-8693 machine token
 * (`act.client_id = customer-ops`, `aud = project-ops`, `workspace_id`). That
 * token resolves to the synthetic principal `federation:customer-ops`, which
 * has no UserRole and therefore sees ZERO projects. That is correct: a service
 * identity must not get broad read access of its own.
 *
 * What Customer-Ops actually wants is "the projects THIS signed-in user can see
 * for this customer". It already names that user in `X-Uc-Uid` (the uchub
 * `sub`). This module turns that hint into a delegated principal ONLY when
 * every condition below holds; otherwise the call keeps today's behaviour
 * (no header) or is refused (header present but not honourable).
 *
 *   1. The bearer is a verified federation machine token (synthetic principal).
 *   2. The actor is on PROJECT_OPS_FEDERATION_ACTORS AND on the fixed
 *      FEDERATION_DELEGATION_ACTORS map below (only customer-ops today).
 *   3. The broker granted the read scope (`projects:read`) on that token.
 *   4. The token carries a workspace claim and the request addresses no other
 *      workspace.
 *   5. `X-Uc-Uid` names an ACTIVE Project-Ops user (by keycloakId) who is not a
 *      CLIENT (clients use the curated portal, never the agent surface).
 *   6. That user holds an ACTIVE membership in the token's workspace, checked
 *      directly (independent of the tenancy flag).
 *
 * The delegated call then runs AS THAT USER, capped to the actor's read scopes
 * (PAT-style scope gate) and bound to the token's workspace (PAT-style
 * workspace chokepoint). The result is never more than the user would see with
 * their own session, and the federation principal itself gains nothing.
 */
import { User, UserRole } from '@prisma/client';
import { WithWorkspaceClaim } from './workspace.util';
import { parseFederationActors } from './federation-token';

/** The request header Customer-Ops already sends with the acting user's uchub sub. */
export const FEDERATION_DELEGATION_HEADER = 'x-uc-uid';

/**
 * Actors allowed to delegate, mapped to the PAT scopes a delegated call is
 * capped at. Read-only by construction: no write scope may ever appear here.
 */
export const FEDERATION_DELEGATION_ACTORS: ReadonlyMap<string, readonly string[]> = new Map([
  ['customer-ops', ['read:projects']],
]);

/** The broker scope that must be on the token for a delegated read. */
export const FEDERATION_DELEGATION_TOKEN_SCOPE = 'projects:read';

export type FederationDelegation =
  | { kind: 'none' }
  | { kind: 'denied'; reason: string }
  | {
      kind: 'delegated';
      actor: string;
      user: User & WithWorkspaceClaim;
      workspaceId: string;
      scopes: string[];
    };

export interface FederationDelegationDeps {
  /** Raw PROJECT_OPS_FEDERATION_ACTORS value. */
  federationActors: string | undefined | null;
  findActiveUserByKeycloakId(keycloakId: string): Promise<User | null>;
  isActiveMember(user: User, workspaceId: string): Promise<boolean>;
}

export function readDelegationHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
): string | null {
  const raw = headers?.[FEDERATION_DELEGATION_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function resolveFederationDelegation(
  deps: FederationDelegationDeps,
  principal: Partial<WithWorkspaceClaim> | null | undefined,
  delegateUcUid: string | null,
  requestWorkspaceId: string | null,
): Promise<FederationDelegation> {
  if (!principal || principal.__isFederationActor !== true) return { kind: 'none' };
  if (!delegateUcUid) return { kind: 'none' };

  const actor = typeof principal.__federationActor === 'string' ? principal.__federationActor : '';
  const capped = FEDERATION_DELEGATION_ACTORS.get(actor);
  if (!actor || !capped || !parseFederationActors(deps.federationActors).has(actor)) {
    return { kind: 'denied', reason: `actor '${actor}' may not act on behalf of a user` };
  }
  if (!(principal.__federationScopes ?? []).includes(FEDERATION_DELEGATION_TOKEN_SCOPE)) {
    return { kind: 'denied', reason: `token lacks ${FEDERATION_DELEGATION_TOKEN_SCOPE}` };
  }
  const workspaceId = principal.__workspaceClaim?.trim();
  if (!workspaceId) {
    return { kind: 'denied', reason: 'token carries no workspace claim' };
  }
  if (requestWorkspaceId && requestWorkspaceId.trim() !== workspaceId) {
    return { kind: 'denied', reason: 'requested workspace differs from the token workspace' };
  }

  const user = await deps.findActiveUserByKeycloakId(delegateUcUid);
  if (!user || !user.isActive) {
    return { kind: 'denied', reason: 'delegated user is unknown or inactive' };
  }
  if (user.role === UserRole.CLIENT) {
    return { kind: 'denied', reason: 'delegated user is a CLIENT' };
  }
  if (!(await deps.isActiveMember(user, workspaceId))) {
    return {
      kind: 'denied',
      reason: 'delegated user is not an active member of the token workspace',
    };
  }

  const delegate = Object.assign(user, {
    __workspaceClaim: workspaceId,
    __ucUid: user.keycloakId,
  }) as User & WithWorkspaceClaim;
  return { kind: 'delegated', actor, user: delegate, workspaceId, scopes: [...capped] };
}
