import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '@prisma/client';
import { MembershipService } from './membership.service';
import { explicitRequestedWorkspaceId, WithWorkspaceClaim } from './workspace.util';
import { SKIP_WORKSPACE_MEMBERSHIP_KEY } from './skip-workspace-membership.decorator';

/**
 * Gate for workspace-scoped routes (SUITE-IDENTITY §D4/§D5).
 *
 * Addressing precedence for the requested workspace (D4):
 *   path param `workspaceId`/`workspace_id` → `X-Workspace-Id` header →
 *   `workspace_id` claim (surfaced as req.user.__workspaceClaim).
 *
 * Behavior is gated by PROJECT_OPS_TENANCY_ENABLED (default OFF) inside
 * MembershipService.resolveAndAuthorize:
 *   - OFF: no-op (resolves to default; never throws) — today's behavior.
 *   - ON : 403 unless the user has an active Membership in the resolved
 *          workspace; the resolved id is stashed on `req.workspaceId` for
 *          handlers / the GUC chokepoint to consume.
 *
 * GLOBAL by default (registered as an APP_GUARD in AppModule) so a new
 * controller cannot silently skip the membership 403 by forgetting to wire it.
 * Routes that legitimately have no human-workspace membership opt OUT with
 * `@SkipWorkspaceMembership()` (auth/health/version + the federation ingest
 * route). The guard remains safe to ALSO list per-route via @UseGuards (several
 * controllers do): a second pass is idempotent — it re-resolves the same
 * workspace and re-stashes the same `req.workspaceId`.
 *
 * Ordering note: as a global guard it runs BEFORE controller/route guards, so
 * it relies on the global JwtAuthGuard (also an APP_GUARD, registered ahead of
 * it) having already populated `req.user`. The `triage/ingest` federation route
 * MUST be opted out, because its per-route FederationActorGuard (which stamps
 * the federation actor + workspace) runs AFTER this global guard.
 */
@Injectable()
export class WorkspaceMembershipGuard implements CanActivate {
  constructor(
    private readonly membership: MembershipService,
    // Optional so direct instantiation (unit tests) without a Reflector still
    // works; in DI Nest always provides it. Absent reflector => never skip.
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // As a GLOBAL guard this also fires on non-HTTP execution contexts
    // (@SubscribeMessage WebSocket handlers), where there is no HTTP request to
    // resolve a workspace from. WS clients are authed at connection time by the
    // gateway; skip cleanly here (matches the global JwtAuthGuard + ThrottlerGuard).
    if (context.getType() !== 'http') {
      return true;
    }

    // Explicit opt-out (@SkipWorkspaceMembership) — checked first so a public /
    // federation route never trips the no-user branch below.
    const skip =
      this.reflector?.getAllAndOverride<boolean>(SKIP_WORKSPACE_MEMBERSHIP_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    if (skip) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const user: (User & Partial<WithWorkspaceClaim>) | undefined = req?.user;
    if (!user) {
      // No authenticated user — let the auth guard own this; don't mask a 401.
      throw new ForbiddenException('Authentication required.');
    }

    // A trusted federation actor has already been authorized by
    // FederationActorGuard (actor allow-list + route scope), which stamped the
    // Brigade-vouched tenant onto req.workspaceId. Such an actor is NOT a
    // member of any workspace (by design — least privilege); skip the human D5
    // membership check for it. Humans never set req.federationActor, so the
    // membership path below is unchanged for every real user.
    if (req.federationActor && req.workspaceId) {
      return true;
    }

    // D4 precedence: explicit path param / X-Workspace-Id header wins; else the
    // validated token claim. When NEITHER is present we pass null (NOT
    // DEFAULT_WORKSPACE_ID) so resolveAndAuthorize falls to the user's DEFAULT
    // membership — a claimless client/operator lands in their OWN workspace,
    // never a fabricated default they may not belong to (e.g. Shafen → GFL, a
    // portal CLIENT → their workspace), which previously 403'd.
    const requested = explicitRequestedWorkspaceId(req) ?? user.__workspaceClaim ?? null;

    const resolved = await this.membership.resolveAndAuthorize(user, requested);
    // Stash for downstream handlers + the withWorkspace GUC chokepoint.
    req.workspaceId = resolved;
    return true;
  }
}
