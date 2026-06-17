import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key read by the (now global) WorkspaceMembershipGuard.
 */
export const SKIP_WORKSPACE_MEMBERSHIP_KEY = 'skipWorkspaceMembership';

/**
 * Opt a route (or controller) OUT of the global workspace-membership 403.
 *
 * WorkspaceMembershipGuard is registered globally (APP_GUARD) so that every
 * route is membership-gated by default — a new controller can no longer
 * silently skip the check by forgetting `@UseGuards(WorkspaceMembershipGuard)`.
 * The few routes that legitimately have no human-workspace membership must
 * declare it explicitly:
 *
 *   - Unauthenticated routes (no user to resolve a membership for): auth
 *     login / Keycloak SSO redirect+callback / client-portal signup, health,
 *     version.
 *   - The federation `triage/ingest` route, whose principal is a trusted
 *     sibling-app actor (NOT a workspace member); its own per-route
 *     FederationActorGuard + WorkspaceMembershipGuard chain authorizes it.
 *
 *   @SkipWorkspaceMembership()
 *   @Post('ingest') ...
 */
export const SkipWorkspaceMembership = () => SetMetadata(SKIP_WORKSPACE_MEMBERSHIP_KEY, true);
