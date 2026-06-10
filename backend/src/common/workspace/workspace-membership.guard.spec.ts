import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { WorkspaceMembershipGuard } from './workspace-membership.guard';
import { MembershipService } from './membership.service';

/**
 * Guard-level contract (SUITE-IDENTITY §D4):
 *   requested = explicit path/header  ??  validated token claim  ??  null
 * and the membership-checked result is stashed on req.workspaceId.
 *
 * The security-relevant case is the last one: when NEITHER an explicit target
 * nor a claim is present, the guard MUST pass `null` (not DEFAULT_WORKSPACE_ID)
 * so MembershipService.resolveAndAuthorize falls to the user's OWN default
 * membership — never a fabricated default the user may not belong to.
 */
describe('WorkspaceMembershipGuard', () => {
  let guard: WorkspaceMembershipGuard;
  let resolveAndAuthorize: jest.Mock;

  const RESOLVED = 'WS-RESOLVED';

  const ctxFor = (req: any): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    resolveAndAuthorize = jest.fn().mockResolvedValue(RESOLVED);
    guard = new WorkspaceMembershipGuard({
      resolveAndAuthorize,
    } as unknown as MembershipService);
  });

  it('throws (not 401-masking) when there is no authenticated user', async () => {
    await expect(guard.canActivate(ctxFor({}))).rejects.toThrow(
      ForbiddenException,
    );
    expect(resolveAndAuthorize).not.toHaveBeenCalled();
  });

  it('uses an explicit X-Workspace-Id header as the requested workspace', async () => {
    const req: any = {
      user: { id: 'u', __workspaceClaim: 'WS-CLAIM' },
      headers: { 'x-workspace-id': 'WS-HEADER' },
    };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(resolveAndAuthorize).toHaveBeenCalledWith(req.user, 'WS-HEADER');
    expect(req.workspaceId).toBe(RESOLVED);
  });

  it('uses a path param as the requested workspace', async () => {
    const req: any = {
      user: { id: 'u' },
      params: { workspaceId: 'WS-PARAM' },
    };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(resolveAndAuthorize).toHaveBeenCalledWith(req.user, 'WS-PARAM');
  });

  it('explicit target takes precedence over the token claim', async () => {
    const req: any = {
      user: { id: 'u', __workspaceClaim: 'WS-CLAIM' },
      headers: { 'x-workspace-id': 'WS-HEADER' },
    };
    await guard.canActivate(ctxFor(req));
    expect(resolveAndAuthorize).toHaveBeenCalledWith(req.user, 'WS-HEADER');
  });

  it('falls back to the validated token claim when there is no explicit target', async () => {
    const req: any = { user: { id: 'u', __workspaceClaim: 'WS-CLAIM' } };
    await guard.canActivate(ctxFor(req));
    expect(resolveAndAuthorize).toHaveBeenCalledWith(req.user, 'WS-CLAIM');
  });

  it('passes null (NOT a default id) when neither explicit target nor claim is present', async () => {
    const req: any = { user: { id: 'u' } };
    await guard.canActivate(ctxFor(req));
    expect(resolveAndAuthorize).toHaveBeenCalledWith(req.user, null);
  });
});
