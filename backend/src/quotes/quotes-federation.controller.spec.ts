import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { QuotesFederationController } from './quotes-federation.controller';
import { FederationStatusFilter } from './federation-status.filter';
import { federationError } from './quote-federation.util';

/**
 * Actor gating at the controller (belt and braces over FederationActorGuard's
 * route scope) + the A7 status envelope every failure is reshaped into.
 */
describe('QuotesFederationController.quoteAccepted — actor gating', () => {
  const dto = { customer_ops_quote_id: 'q-0001', number: 'Q-2026-0001', version: 1 } as any;
  const user = { id: 'federation:customer-ops', __isFederationActor: true } as any;

  function make(created = true) {
    const service = {
      acceptQuote: jest.fn(async () => ({
        status: 'done',
        created,
        project_id: 'p1',
        project_number: 'PROJ-2026-000001',
        task_ids: ['t1'],
        document_id: 'd1',
        contact_linked: true,
        schedule_ids: [],
        quote: { customer_ops_quote_id: 'q-0001', number: 'Q-2026-0001', version: 1 },
      })),
    };
    const res = { status: jest.fn() };
    return { ctrl: new QuotesFederationController(service as any), service, res };
  }

  it('runs for the customer-ops actor in the guard-stamped workspace and answers 201 on create', async () => {
    const { ctrl, service, res } = make(true);
    const req = {
      federationActor: 'customer-ops',
      workspaceId: 'ws-1',
      headers: { 'x-workspace-id': 'ws-EVIL' },
    };
    const out = await ctrl.quoteAccepted(user, req, dto, res as any);
    // The X-Workspace-Id header is never consulted: the Brigade-vouched claim (req.workspaceId) is the boundary.
    expect(service.acceptQuote).toHaveBeenCalledWith('ws-1', user, dto, {
      federationActor: 'customer-ops',
    });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.CREATED);
    expect(out.status).toBe('done');
  });

  it('answers 200 on an idempotent replay', async () => {
    const { ctrl, res } = make(false);
    await ctrl.quoteAccepted(
      user,
      { federationActor: 'customer-ops', workspaceId: 'ws-1' },
      dto,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(HttpStatus.OK);
  });

  it.each([
    [
      'a human (even ADMIN) — no federation actor',
      { workspaceId: 'ws-1' },
      { id: 'u1', role: 'ADMIN' },
    ],
    [
      'another allow-listed sibling (meeting-ops)',
      { federationActor: 'meeting-ops', workspaceId: 'ws-1' },
      user,
    ],
    ['customer-ops without a vouched workspace', { federationActor: 'customer-ops' }, user],
  ])(
    'rejects %s with 403 FEDERATION_ACTOR_REQUIRED and never calls the service',
    async (_label, req, u) => {
      const { ctrl, service, res } = make();
      let err: HttpException | undefined;
      try {
        await ctrl.quoteAccepted(u as any, req as any, dto, res as any);
      } catch (e) {
        err = e as HttpException;
      }
      expect(err).toBeInstanceOf(HttpException);
      expect(err!.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect(err!.getResponse()).toMatchObject({
        status: 'failed',
        code: 'FEDERATION_ACTOR_REQUIRED',
      });
      expect(service.acceptQuote).not.toHaveBeenCalled();
    },
  );
});

describe('FederationStatusFilter.classify — the A7 envelope', () => {
  it('passes a federationError envelope through unchanged', () => {
    expect(
      FederationStatusFilter.classify(
        federationError(HttpStatus.BAD_GATEWAY, 'PDF_FETCH_FAILED', 'upstream 500'),
      ),
    ).toEqual({
      httpStatus: 502,
      code: 'PDF_FETCH_FAILED',
      reason: 'upstream 500',
    });
  });

  it('turns a ValidationPipe 400 (message array) into VALIDATION with a joined reason', () => {
    const err = new BadRequestException([
      'currency must be exactly 3 characters',
      'billing.schedule_text must be a string',
    ]);
    expect(FederationStatusFilter.classify(err)).toEqual({
      httpStatus: 400,
      code: 'VALIDATION',
      reason: 'currency must be exactly 3 characters; billing.schedule_text must be a string',
    });
  });

  it('maps common HTTP errors to stable codes', () => {
    expect(FederationStatusFilter.classify(new NotFoundException('gone')).code).toBe('NOT_FOUND');
    expect(
      FederationStatusFilter.classify(new HttpException('nope', HttpStatus.UNAUTHORIZED)).code,
    ).toBe('UNAUTHENTICATED');
    expect(
      FederationStatusFilter.classify(new HttpException('slow down', HttpStatus.TOO_MANY_REQUESTS))
        .code,
    ).toBe('RATE_LIMITED');
  });

  it('never leaks an unexpected error message; answers 500 INTERNAL with a retry hint', () => {
    const out = FederationStatusFilter.classify(new Error('secret db string in message'));
    expect(out.httpStatus).toBe(500);
    expect(out.code).toBe('INTERNAL');
    expect(out.reason).not.toContain('secret');
    expect(out.reason).toMatch(/retry federation/);
  });

  it('writes the envelope to the response', () => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ method: 'POST', originalUrl: '/api/v1/federation/quotes/accepted' }),
      }),
    } as any;
    new FederationStatusFilter().catch(
      federationError(HttpStatus.FORBIDDEN, 'FEDERATION_ACTOR_REQUIRED', 'no'),
      host,
    );
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      status: 'failed',
      code: 'FEDERATION_ACTOR_REQUIRED',
      reason: 'no',
      http_status: 403,
    });
  });
});
