import { WorkspaceContextService } from './workspace-context.service';
import { MembershipService } from './membership.service';

/**
 * Regression guard for the claimless-PAT tenancy bug (2026-06-10): the MCP/PAT
 * path used to resolve a claimless caller to the global DEFAULT_WORKSPACE_ID and
 * then 403 ("Not a member of the requested workspace") any user — e.g. Shafen,
 * whose only active membership is Brightwater Labs — who isn't a member of that
 * env default. resolveAuthorized must instead pass the addressing precedence
 * down to MembershipService: explicit request → token claim → null (let
 * MembershipService pick the user's DEFAULT MEMBERSHIP). It must NEVER substitute
 * the env default as the "requested" workspace.
 */
describe('WorkspaceContextService.resolveAuthorized — addressing precedence', () => {
  function make() {
    const resolveAndAuthorize = jest.fn().mockResolvedValue('RESOLVED_WS');
    const membership = { resolveAndAuthorize } as unknown as MembershipService;
    // If anything reads the env default to source the *claim*, this returns a
    // sentinel we assert is NEVER what gets passed to MembershipService.
    const config = { get: jest.fn().mockReturnValue('ENV_DEFAULT_WS') } as any;
    const prisma = {} as any;
    const svc = new WorkspaceContextService(config, prisma, membership);
    return { svc, resolveAndAuthorize };
  }

  const user = (claim?: string | null) =>
    ({ id: 'u1', email: 'p@x.com', keycloakId: 'kc1', __workspaceClaim: claim }) as any;

  const claimArg = (m: jest.Mock) => m.mock.calls[0][1];

  it('claimless caller → null (default membership), NOT the env default', async () => {
    const { svc, resolveAndAuthorize } = make();
    await svc.resolveAuthorized(user(undefined));
    expect(claimArg(resolveAndAuthorize)).toBeNull();
    expect(resolveAndAuthorize).not.toHaveBeenCalledWith(expect.anything(), 'ENV_DEFAULT_WS');
  });

  it('null token claim → null (default membership)', async () => {
    const { svc, resolveAndAuthorize } = make();
    await svc.resolveAuthorized(user(null));
    expect(claimArg(resolveAndAuthorize)).toBeNull();
  });

  it('empty/whitespace token claim → null (treated as absent)', async () => {
    const { svc, resolveAndAuthorize } = make();
    await svc.resolveAuthorized(user('   '));
    expect(claimArg(resolveAndAuthorize)).toBeNull();
  });

  it("token's own workspace claim is honored when present", async () => {
    const { svc, resolveAndAuthorize } = make();
    await svc.resolveAuthorized(user('WS_FROM_TOKEN'));
    expect(claimArg(resolveAndAuthorize)).toBe('WS_FROM_TOKEN');
  });

  it('an explicit requested workspace wins over the token claim', async () => {
    const { svc, resolveAndAuthorize } = make();
    await svc.resolveAuthorized(user('WS_FROM_TOKEN'), 'WS_EXPLICIT');
    expect(claimArg(resolveAndAuthorize)).toBe('WS_EXPLICIT');
  });

  it('returns whatever MembershipService authorized', async () => {
    const { svc } = make();
    await expect(svc.resolveAuthorized(user(undefined))).resolves.toBe('RESOLVED_WS');
  });
});
