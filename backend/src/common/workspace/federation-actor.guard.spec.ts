import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FederationActorGuard } from './federation-actor.guard';
import { FEDERATION_ACTOR_REQUIRED } from './federation-token';

/**
 * FederationActorGuard: elevate a trusted sibling-app MACHINE actor ONLY when
 * ALL hold — synthetic federation principal (__isFederationActor), the actor is
 * on PROJECT_OPS_FEDERATION_ACTORS, the handler is a federation write route,
 * and a vouched workspace claim is present. Then it stamps req.workspaceId +
 * req.federationActor.
 *
 * On federation write routes (ingest, quoteAccepted) anything else is 403
 * FEDERATION_ACTOR_REQUIRED — human tokens, unknown actors, missing
 * workspace. Non-federation handlers still fall through (no marker).
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

  const expectActorRequired = (fn: () => unknown) => {
    try {
      fn();
      throw new Error('expected ForbiddenException');
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect((e as ForbiddenException).getResponse()).toMatchObject({
        status: 'failed',
        code: FEDERATION_ACTOR_REQUIRED,
      });
    }
  };

  it('elevates an allow-listed federation actor on the ingest route', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.workspaceId).toBe(WS);
    expect(req.federationActor).toBe('meeting-ops');
  });

  it('rejects an actor that is not allow-listed (unknown-actor)', () => {
    const req: any = { user: fedUser('rogue-app', WS) };
    expectActorRequired(() => guardWith('meeting-ops').canActivate(ctx(req, 'ingest')));
    expect(req.federationActor).toBeUndefined();
    expect(req.workspaceId).toBeUndefined();
  });

  it('rejects with an empty allow-list (default = zero trust)', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expectActorRequired(() => guardWith('').canActivate(ctx(req, 'ingest')));
    expect(req.federationActor).toBeUndefined();
  });

  it('does NOT elevate on a non-federation route (e.g. approve) — falls through', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expect(guardWith('meeting-ops').canActivate(ctx(req, 'approve'))).toBe(true);
    expect(req.federationActor).toBeUndefined();
  });

  it('rejects a human (even STAFF) on ingest — no human session on federation writes', () => {
    const req: any = {
      user: { id: 'u1', role: 'STAFF', __workspaceClaim: WS },
    };
    expectActorRequired(() => guardWith('meeting-ops').canActivate(ctx(req, 'ingest')));
    expect(req.federationActor).toBeUndefined();
  });

  it('rejects a federation actor missing a workspace claim', () => {
    const req: any = { user: fedUser('meeting-ops', null) };
    expectActorRequired(() => guardWith('meeting-ops').canActivate(ctx(req, 'ingest')));
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

/**
 * Quotes & Proposals seam: `quoteAccepted` is SCOPED to `customer-ops`.
 * Another allow-listed sibling is 403; humans are 403; workspace is ALWAYS
 * the vouched claim — the X-Workspace-Id header is never read.
 */
describe('FederationActorGuard — quotes seam route scope (quoteAccepted)', () => {
  const WS = '01924a3c-0000-7f1a-beef-67f1ab5c0001';
  const OTHER_WS = '01924a3c-0000-7f1a-beef-67f1ab5c0002';

  const guardWith = (allow: string) =>
    new FederationActorGuard({ get: (_k: string, def?: string) => allow ?? def ?? '' } as unknown as ConfigService);

  const ctx = (req: any, handlerName: string): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({ name: handlerName }),
    }) as unknown as ExecutionContext;

  const fedUser = (actor: string, ws: string | null) => ({
    id: `federation:${actor}`,
    __isFederationActor: true,
    __federationActor: actor,
    __workspaceClaim: ws,
  });

  const expectActorRequired = (fn: () => unknown) => {
    expect(fn).toThrow(ForbiddenException);
  };

  it('elevates an allow-listed customer-ops actor on quoteAccepted', () => {
    const req: any = { user: fedUser('customer-ops', WS) };
    expect(guardWith('customer-ops').canActivate(ctx(req, 'quoteAccepted'))).toBe(true);
    expect(req.federationActor).toBe('customer-ops');
    expect(req.workspaceId).toBe(WS);
  });

  it('rejects meeting-ops on quoteAccepted even when it is allow-listed (route scope)', () => {
    const req: any = { user: fedUser('meeting-ops', WS) };
    expectActorRequired(() =>
      guardWith('meeting-ops, customer-ops').canActivate(ctx(req, 'quoteAccepted')),
    );
    expect(req.federationActor).toBeUndefined();
    expect(req.workspaceId).toBeUndefined();
  });

  it('rejects customer-ops when it is not on PROJECT_OPS_FEDERATION_ACTORS', () => {
    const req: any = { user: fedUser('customer-ops', WS) };
    expectActorRequired(() => guardWith('meeting-ops').canActivate(ctx(req, 'quoteAccepted')));
    expect(req.federationActor).toBeUndefined();
  });

  it('stamps the vouched claim and ignores an X-Workspace-Id header', () => {
    const req: any = {
      user: fedUser('customer-ops', WS),
      headers: { 'x-workspace-id': OTHER_WS },
      params: { workspaceId: OTHER_WS },
    };
    expect(guardWith('customer-ops').canActivate(ctx(req, 'quoteAccepted'))).toBe(true);
    expect(req.workspaceId).toBe(WS);
  });

  it('rejects a human principal on quoteAccepted', () => {
    const req: any = { user: { id: 'u1', role: 'ADMIN', __workspaceClaim: WS } };
    expectActorRequired(() => guardWith('customer-ops').canActivate(ctx(req, 'quoteAccepted')));
    expect(req.federationActor).toBeUndefined();
  });

  it('keeps the ingest contract: any allow-listed actor (customer-ops included) is elevated there', () => {
    const req: any = { user: fedUser('customer-ops', WS) };
    expect(guardWith('customer-ops').canActivate(ctx(req, 'ingest'))).toBe(true);
    expect(req.federationActor).toBe('customer-ops');
  });
});
