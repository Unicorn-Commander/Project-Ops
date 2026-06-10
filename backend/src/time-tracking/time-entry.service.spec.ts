import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { TimeEntryService } from './time-entry.service';

function makeService(fakes: {
  entryFindFirst?: (args: any) => any;
  projectFindFirst?: (args: any) => any;
  config?: Record<string, string>;
}) {
  const prisma = {
    timeEntry: {
      findFirst: async (args: any) => fakes.entryFindFirst?.(args) ?? null,
      create: async ({ data }: any) => ({ id: 'new', ...data }),
      update: async ({ data }: any) => ({ id: 'e1', ...data }),
    },
    project: {
      findFirst: async (args: any) => fakes.projectFindFirst?.(args) ?? { id: 'p1' },
    },
  };
  const financials = {
    resolveBillablePolicy: async () => ({ projectId: 'p1', billable: true }),
    compute: async () => ({
      durationSeconds: 3600,
      roundingAppliedSeconds: 3600,
      billRateApplied: null,
      costRateApplied: null,
      currency: 'USD',
      billableAmount: null,
    }),
  };
  const audit = { log: async () => null };
  const events = { emit: () => true };
  const config = { get: (k: string, d?: string) => fakes.config?.[k] ?? d };
  // Tenancy: services now wrap bodies in workspaceContext.runForUser(user, fn,
  // wsId). The fake invokes fn with the fake prisma standing in for the tx, so
  // the wrapped logic runs against the same fakes as before.
  const workspaceContext = {
    runForUser: async (_user: any, fn: (tx: any) => any) => fn(prisma),
  };
  return new TimeEntryService(
    prisma as any,
    financials as any,
    audit as any,
    events as any,
    config as any,
    workspaceContext as any,
  );
}

const admin = { id: 'u1', role: UserRole.ADMIN, email: 'a@x.co' } as any;
const staff = { id: 'u1', role: UserRole.STAFF, email: 's@x.co' } as any;
const client = { id: 'u1', role: UserRole.CLIENT, email: 'c@x.co' } as any;

describe('TimeEntryService immutability + access', () => {
  it('refuses to edit a billed entry', async () => {
    const svc = makeService({
      entryFindFirst: () => ({
        id: 'e1',
        userId: 'u1',
        workspaceId: 'ws',
        billed: true,
        lockedAt: null,
        approvalStatus: 'DRAFT',
      }),
    });
    await expect(svc.update('ws', admin, 'e1', { description: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses to edit a locked entry', async () => {
    const svc = makeService({
      entryFindFirst: () => ({
        id: 'e1',
        userId: 'u1',
        workspaceId: 'ws',
        billed: false,
        lockedAt: new Date(),
        approvalStatus: 'APPROVED',
      }),
    });
    await expect(svc.update('ws', admin, 'e1', { description: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("refuses when a non-elevated user edits someone else's entry", async () => {
    const svc = makeService({
      entryFindFirst: () => ({
        id: 'e1',
        userId: 'someone-else',
        workspaceId: 'ws',
        billed: false,
        lockedAt: null,
        approvalStatus: 'DRAFT',
      }),
    });
    await expect(svc.update('ws', staff, 'e1', { description: 'x' })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks CLIENT from logging time', async () => {
    const svc = makeService({});
    await expect(svc.logTime('ws', client, { projectId: 'p1', durationMinutes: 30 })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects an overlapping manual entry when overlaps are not allowed', async () => {
    const svc = makeService({
      config: { ALLOW_OVERLAPPING_ENTRIES: 'false' },
      entryFindFirst: () => ({ id: 'existing' }), // overlap probe finds a hit
      projectFindFirst: () => ({ id: 'p1' }),
    });
    await expect(
      svc.logTime('ws', staff, { projectId: 'p1', durationMinutes: 60 }),
    ).rejects.toThrow(BadRequestException);
  });
});
