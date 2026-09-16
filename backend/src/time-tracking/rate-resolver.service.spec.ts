import { RateResolverService } from './rate-resolver.service';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';

// Minimal fake: the resolver does the ranking in code, so findMany just returns
// the candidate rows we hand it (as if the DB already filtered scope + window).
// Tenancy: resolve() now takes the workspace `tx` first; the fake doubles as the
// tx surface (it only needs billingRate.findMany).
function resolverWith(rows: any[]): { svc: RateResolverService; tx: WorkspaceTxClient } {
  const tx = {
    billingRate: { findMany: async () => rows },
  } as unknown as WorkspaceTxClient;
  const svc = new RateResolverService(tx as unknown as PrismaService);
  return { svc, tx };
}

function rateRow(over: Partial<any>): any {
  return {
    scopeType: 'USER',
    organizationId: null,
    currency: 'USD',
    costRate: null,
    effectiveFrom: new Date('2026-01-01'),
    effectiveTo: null,
    ...over,
  };
}

const base = { workspaceId: 'ws', date: new Date('2026-06-01'), userId: 'u1', projectId: 'p1' };

describe('RateResolverService precedence', () => {
  it('prefers the more specific scope (PROJECT over USER)', async () => {
    const { svc, tx } = resolverWith([
      rateRow({ scopeType: 'USER', billRate: 100 }),
      rateRow({ scopeType: 'PROJECT', billRate: 150 }),
    ]);
    const r = await svc.resolve(tx, base);
    expect(r.billRate?.toNumber()).toBe(150);
    expect(r.source).toBe('RATE_PROJECT');
  });

  it('Task.billRate override beats every rate row', async () => {
    const { svc, tx } = resolverWith([rateRow({ scopeType: 'PROJECT', billRate: 150 })]);
    const r = await svc.resolve(tx, { ...base, taskBillRate: 200 });
    expect(r.billRate?.toNumber()).toBe(200);
    expect(r.source).toBe('TASK_OVERRIDE');
  });

  it('Project.defaultBillRate sits below PROJECT rate but above CONTACT/USER', async () => {
    const { svc, tx } = resolverWith([rateRow({ scopeType: 'USER', billRate: 100 })]);
    const r = await svc.resolve(tx, { ...base, projectDefaultBillRate: 175 });
    expect(r.billRate?.toNumber()).toBe(175);
    expect(r.source).toBe('PROJECT_DEFAULT');
  });

  it('resolves cost independently from the most-specific row carrying a cost', async () => {
    const { svc, tx } = resolverWith([
      rateRow({ scopeType: 'PROJECT', billRate: 150, costRate: 70 }),
    ]);
    // Bill rate comes from the task override (no cost); cost still resolves.
    const r = await svc.resolve(tx, { ...base, taskBillRate: 200 });
    expect(r.billRate?.toNumber()).toBe(200);
    expect(r.costRate?.toNumber()).toBe(70);
  });

  it('carries the currency of the chosen rate row', async () => {
    const { svc, tx } = resolverWith([
      rateRow({ scopeType: 'PROJECT', billRate: 150, currency: 'EUR' }),
    ]);
    const r = await svc.resolve(tx, base);
    expect(r.currency).toBe('EUR');
  });

  it('falls back to ORG global (organizationId null) at lowest precedence', async () => {
    const { svc, tx } = resolverWith([
      rateRow({ scopeType: 'ORG', organizationId: null, billRate: 90 }),
    ]);
    const r = await svc.resolve(tx, base);
    expect(r.billRate?.toNumber()).toBe(90);
    expect(r.source).toBe('RATE_ORG');
  });

  it('returns null bill rate + NONE when nothing matches', async () => {
    const { svc, tx } = resolverWith([]);
    const r = await svc.resolve(tx, base);
    expect(r.billRate).toBeNull();
    expect(r.source).toBe('NONE');
    expect(r.currency).toBe('USD');
  });

  it('breaks scope ties by the most recent effectiveFrom', async () => {
    const { svc, tx } = resolverWith([
      rateRow({ scopeType: 'PROJECT', billRate: 100, effectiveFrom: new Date('2026-01-01') }),
      rateRow({ scopeType: 'PROJECT', billRate: 160, effectiveFrom: new Date('2026-05-01') }),
    ]);
    const r = await svc.resolve(tx, base);
    expect(r.billRate?.toNumber()).toBe(160);
  });
});
