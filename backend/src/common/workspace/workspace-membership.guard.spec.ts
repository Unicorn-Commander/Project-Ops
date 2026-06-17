import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
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

  const ctxFor = (req: any, handler: any = () => undefined): ExecutionContext =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => class {},
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

  // Global-guard opt-out (@SkipWorkspaceMembership). When the guard runs as a
  // global APP_GUARD it must honor the metadata flag — so a public/federation
  // route is NOT membership-gated (and never trips the no-user 403 above).
  describe('global opt-out via @SkipWorkspaceMembership', () => {
    const guardWithReflector = (skip: boolean) => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(skip),
      } as unknown as Reflector;
      return new WorkspaceMembershipGuard(
        { resolveAndAuthorize } as unknown as MembershipService,
        reflector,
      );
    };

    it('returns true WITHOUT resolving membership when the route opts out', async () => {
      const g = guardWithReflector(true);
      // No user on the request — would normally 403; the opt-out short-circuits.
      await expect(g.canActivate(ctxFor({}))).resolves.toBe(true);
      expect(resolveAndAuthorize).not.toHaveBeenCalled();
    });

    it('still enforces membership when the route does NOT opt out', async () => {
      const g = guardWithReflector(false);
      const req: any = { user: { id: 'u' } };
      await expect(g.canActivate(ctxFor(req))).resolves.toBe(true);
      expect(resolveAndAuthorize).toHaveBeenCalledWith(req.user, null);
    });
  });
});
