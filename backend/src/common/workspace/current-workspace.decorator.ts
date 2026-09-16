import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { defaultWorkspaceId, resolveWorkspaceId } from './workspace.util';

/**
 * Injects the active workspace id into a controller handler.
 *
 *   create(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User)
 *
 * Prefers the workspace the WorkspaceMembershipGuard already resolved AND
 * authorized onto `req.workspaceId` (the membership-checked id). For routes that
 * read the workspace without that guard, it falls back to the validated JWT
 * claim (`req.user.__workspaceClaim`) then DEFAULT_WORKSPACE_ID. Never reads an
 * HTTP header itself (the suite model forbids trusting one for tenancy; only the
 * guard consumes X-Workspace-Id, after a membership check).
 */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request?.workspaceId ?? resolveWorkspaceId(request?.user, defaultWorkspaceId());
  },
);
