import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { MembershipService } from './membership.service';
import {
  explicitRequestedWorkspaceId,
  WithWorkspaceClaim,
} from './workspace.util';

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
 * This guard is additive: it is NOT applied globally here. Routes opt in via
 * `@UseGuards(WorkspaceMembershipGuard)`. Wiring it onto the workspace REST
 * surface is the Phase-2+ step that flips alongside the runtime role.
 */
@Injectable()
export class WorkspaceMembershipGuard implements CanActivate {
  constructor(private readonly membership: MembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user: (User & Partial<WithWorkspaceClaim>) | undefined = req?.user;
    if (!user) {
      // No authenticated user — let the auth guard own this; don't mask a 401.
      throw new ForbiddenException('Authentication required.');
    }

    // D4 precedence: explicit path param / X-Workspace-Id header wins; else the
    // validated token claim. When NEITHER is present we pass null (NOT
    // DEFAULT_WORKSPACE_ID) so resolveAndAuthorize falls to the user's DEFAULT
    // membership — a claimless client/operator lands in their OWN workspace,
    // never a fabricated default they may not belong to (e.g. Shafen → GFL, a
    // portal CLIENT → their workspace), which previously 403'd.
    const requested =
      explicitRequestedWorkspaceId(req) ?? user.__workspaceClaim ?? null;

    const resolved = await this.membership.resolveAndAuthorize(user, requested);
    // Stash for downstream handlers + the withWorkspace GUC chokepoint.
    req.workspaceId = resolved;
    return true;
  }
}
