import { BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { BillingRateService } from './billing-rate.service';
import { RateResolverService } from './rate-resolver.service';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { CreateBillingRateDto } from './dto/create-billing-rate.dto';

/**
 * Fake BillingRateService: the create() body runs inside
 * workspaceContext.runForUser(user, fn, wsId); the fake invokes fn with a fake
 * `tx` so assertScopeColumns (which runs BEFORE the tx) and the create path are
 * exercised against in-memory stand-ins. We capture what billingRate.create was
 * asked to persist so a test can assert the stored scope columns.
 */
function makeService() {
  const created: any[] = [];
  const tx = {
    billingRate: {
      create: async ({ data }: any) => {
        const row = { id: `rate-${created.length + 1}`, ...data };
        created.push(row);
        return row;
      },
    },
  };
  const audit = { log: async () => null };
  const workspaceContext = {
    runForUser: async (_user: any, fn: (t: any) => any) => fn(tx),
  };
  const svc = new BillingRateService(
    {} as unknown as PrismaService,
    audit as any,
    workspaceContext as any,
  );
  return { svc, created };
}

const admin = { id: 'u1', role: UserRole.ADMIN, email: 'a@x.co' } as any;

function orgRate(over: Partial<CreateBillingRateDto>): CreateBillingRateDto {
  return { scopeType: 'ORG' as any, billRate: 90, ...over } as CreateBillingRateDto;
}

describe('BillingRateService.assertScopeColumns — ORG scope', () => {
  it('accepts an ORG rate WITH an organizationId (org-specific)', async () => {
    const { svc, created } = makeService();
    const out = await svc.create('ws', admin, orgRate({ organizationId: 'org-1', billRate: 120 }));
    expect(out.organizationId).toBe('org-1');
    expect(out.scopeType).toBe('ORG');
    expect(created).toHaveLength(1);
    expect(created[0].organizationId).toBe('org-1');
  });

  it('accepts an ORG rate WITHOUT an organizationId as the explicit workspace-wide default', async () => {
    const { svc, created } = makeService();
    const out = await svc.create('ws', admin, orgRate({ billRate: 90 }));
    // Stored with a null organizationId so the resolver treats it as the
    // lowest-precedence workspace default (rowRank 10), not an org-specific rate.
    expect(out.organizationId).toBeNull();
    expect(created[0].organizationId).toBeNull();
  });

  it('REJECTS an ORG rate with no organizationId but a stray scope column (silent-mischarge guard)', async () => {
    const { svc } = makeService();
    await expect(
      svc.create('ws', admin, orgRate({ userId: 'u9' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.create('ws', admin, orgRate({ projectId: 'p9' })),
    ).rejects.toThrow(/workspace-wide default/i);
  });

  it('still enforces the required column for a non-ORG scope (PROJECT requires projectId)', async () => {
    const { svc } = makeService();
    await expect(
      svc.create('ws', admin, { scopeType: 'PROJECT' as any, billRate: 100 } as CreateBillingRateDto),
    ).rejects.toThrow(/PROJECT rate requires projectId/);
  });

  it('still enforces USER_PROJECT requiring both userId and projectId', async () => {
    const { svc } = makeService();
    await expect(
      svc.create('ws', admin, {
        scopeType: 'USER_PROJECT' as any,
        userId: 'u1',
        billRate: 100,
      } as CreateBillingRateDto),
    ).rejects.toThrow(/USER_PROJECT rate requires both/);
  });
});

// ── Resolver selects the correct ORG rate given both forms exist ──
// Minimal fake: the resolver ranks rows in code, so findMany returns the
// candidate rows directly (as if the DB already filtered scope + effective
// window) — mirrors rate-resolver.service.spec.ts.
function resolverWith(rows: any[]): { svc: RateResolverService; tx: WorkspaceTxClient } {
  const tx = {
    billingRate: { findMany: async () => rows },
  } as unknown as WorkspaceTxClient;
  const svc = new RateResolverService(tx as unknown as PrismaService);
  return { svc, tx };
}

function rateRow(over: Partial<any>): any {
  return {
    scopeType: 'ORG',
    organizationId: null,
    currency: 'USD',
    costRate: null,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    ...over,
  };
}

const base = { workspaceId: 'ws', date: new Date('2026-06-01'), userId: 'u1', projectId: 'p1' };

describe('RateResolverService — ORG specific vs workspace-wide default', () => {
  it('prefers the org-specific ORG rate over the workspace-wide default for that org', async () => {
    const { svc, tx } = resolverWith([
      rateRow({ organizationId: null, billRate: 90 }), // workspace default
      rateRow({ organizationId: 'org-1', billRate: 140 }), // org-specific
    ]);
    const r = await svc.resolve(tx, { ...base, organizationId: 'org-1' });
    expect(r.billRate?.toNumber()).toBe(140);
    expect(r.source).toBe('RATE_ORG');
  });

  it('falls back to the workspace-wide default when no org-specific rate matches', async () => {
    const { svc, tx } = resolverWith([rateRow({ organizationId: null, billRate: 90 })]);
    // Entry whose project has no organization at all.
    const r = await svc.resolve(tx, { ...base, organizationId: null });
    expect(r.billRate?.toNumber()).toBe(90);
    expect(r.source).toBe('RATE_ORG');
  });
});
