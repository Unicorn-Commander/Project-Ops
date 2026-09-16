import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { MembershipService } from './membership.service';
import { explicitRequestedWorkspaceId } from './workspace.util';

/** Runs after FederationActorGuard on its explicitly scoped ingest route. */
@Injectable()
export class WorkspaceMutationGuard implements CanActivate {
  constructor(private readonly membership: MembershipService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    if (req.federationActor && req.workspaceId) return true;
    const requested = explicitRequestedWorkspaceId(req) ?? req.user?.__workspaceClaim ?? null;
    const workspaceId = await this.membership.resolveAndAuthorize(req.user, requested);
    await this.membership.assertCanWrite(req.user, workspaceId);
    req.workspaceId = workspaceId;
    return true;
  }
}
