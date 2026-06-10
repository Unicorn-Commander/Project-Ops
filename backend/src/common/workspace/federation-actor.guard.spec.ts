import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FederationActorGuard } from './federation-actor.guard';

/**
 * FederationActorGuard contract: elevate a trusted sibling-app actor ONLY when
 * ALL hold — synthetic federation principal (__isFederationActor), the actor is
 * on PROJECT_OPS_FEDERATION_ACTORS, the handler is a federation route
 * (`ingest`), and a Brigade-vouched workspace claim is present. Then it stamps
 * req.workspaceId + req.federationActor. Otherwise it falls through (no marker)
 * so the human RolesGuard + WorkspaceMembershipGuard reject as usual.
 */
describe('FederationActorGuard', () => {
  const WS = '01924a3c-0000-7f1a-beef-67f1ab5c0001';

  const guardWith = (allow: string) => {
    const config = {
      get: (_k: string, def?: string) => allow ?? def ?? '',
    } as unknown as ConfigService;
    return new FederationActorGuard(config);
  };

  const ctx = (req: any, handlerName: string): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({ name: handlerName }),
    }) as unknown as ExecutionContext;

  const fedUser = (actor: string | null, ws: string | null) => ({
    id: `federation:${actor}`,
    __isFederationActor: true,
    __federationActor: actor,
    __workspaceClaim: ws,
  });

  it('elevates an allow-listed federation actor on the ingest route', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.workspaceId).toBe(WS);
    expect(req.federationActor).toBe('meeting-ops');
  });

  it('does NOT elevate an actor that is not allow-listed (falls through)', () => {
    const req: any = { user: fedUser('rogue-app', WS) };
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.federationActor).toBeUndefined();
    expect(req.workspaceId).toBeUndefined();
  });

  it('does NOT elevate with an empty allow-list (default = zero trust)', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expect(guardWith('').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.federationActor).toBeUndefined();
  });

  it('does NOT elevate on a non-federation route (e.g. approve)', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'approve'))).toBe(true);
    expect(req.federationActor).toBeUndefined();
  });

  it('does NOT elevate a non-federation (human) principal even on ingest', () => {
    const req: any = {
      user: { id: 'u1', role: 'STAFF', __workspaceClaim: WS },
    };
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.federationActor).toBeUndefined();
  });

  it('does NOT elevate a federation actor missing a workspace claim', () => {
    const req: any = { user: fedUser('meeting-ops', null) };
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.federationActor).toBeUndefined();
  });

  it('passes through (no throw) when there is no authenticated user', () => {
    const req: any = {};
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.federationActor).toBeUndefined();
  });

  it('honors a multi-actor allow-list', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expect(
      guardWith('contact-ops, meeting-ops').canActivate(ctx(req, 'ingest')),
    ).toBe(true);
    expect(req.federationActor).toBe('meeting-ops');
  });
});
