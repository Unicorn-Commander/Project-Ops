import { AgentEventsService } from './agent-events.service';
import { AgentActorKind, AgentVia } from '@prisma/client';

/**
 * Unit tests for the agent activity & usage service. workspaceContext is faked:
 * `runForUser`/`runInWorkspace` invoke the callback with a fake tx, so the real
 * aggregation/fold logic runs without a DB. Decimal money fields are passed as
 * strings (how Prisma returns them).
 */

const admin = {
  id: 'a1',
  firstName: 'Ada',
  lastName: 'Min',
  email: 'ada@x.io',
  role: 'ADMIN',
} as any;

function makeService(tx: any, opts?: { resolve?: string }) {
  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
    runInWorkspace: jest.fn(async (_ws: string, _uid: any, fn: (t: any) => any) => fn(tx)),
    resolve: jest.fn(() => opts?.resolve ?? 'ws-1'),
  };
  const svc = new AgentEventsService({} as any, workspaceContext as any);
  return { svc, workspaceContext };
}

describe('AgentEventsService.record (resilient recorder)', () => {
  it('writes an AgentEvent inside the workspace RLS context and returns its id', async () => {
    const create = jest.fn(async (_args: any) => ({ id: 'evt-1' }));
    const tx = { agentEvent: { create } };
    const { svc, workspaceContext } = makeService(tx);

    const id = await svc.record({
      workspaceId: 'ws-1',
      user: admin,
      actorKind: AgentActorKind.PAT,
      actorKey: 'pat-9',
      actorLabel: 'Claude Code',
      via: AgentVia.MCP,
      action: 'create_task',
      projectId: 'p1',
      taskId: 't1',
    });

    expect(id).toBe('evt-1');
    expect(workspaceContext.runInWorkspace).toHaveBeenCalledWith(
      'ws-1',
      expect.anything(),
      expect.any(Function),
    );
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      workspaceId: 'ws-1',
      actorKind: AgentActorKind.PAT,
      actorKey: 'pat-9',
      via: AgentVia.MCP,
      action: 'create_task',
      projectId: 'p1',
      taskId: 't1',
    });
  });

  it('NEVER throws when the DB write fails — returns null', async () => {
    const tx = {
      agentEvent: {
        create: jest.fn(async () => {
          throw new Error('db down');
        }),
      },
    };
    const { svc } = makeService(tx);
    await expect(
      svc.record({
        workspaceId: 'ws-1',
        actorKind: AgentActorKind.SYSTEM,
        actorKey: 'sys',
        actorLabel: 'System',
        via: AgentVia.SYSTEM,
        action: 'x',
      }),
    ).resolves.toBeNull();
  });

  it('drops (returns null) when workspaceId is missing, without touching the DB', async () => {
    const create = jest.fn();
    const tx = { agentEvent: { create } };
    const { svc } = makeService(tx);
    const id = await svc.record({
      workspaceId: '',
      actorKind: AgentActorKind.USER,
      actorKey: 'u',
      actorLabel: 'U',
      via: AgentVia.API,
      action: 'x',
    });
    expect(id).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('recordForUser resolves the workspace from the user and records', async () => {
    const create = jest.fn(async (_args: any) => ({ id: 'evt-2' }));
    const tx = { agentEvent: { create } };
    const { svc } = makeService(tx, { resolve: 'ws-77' });
    const id = await svc.recordForUser(admin, {
      actorKind: AgentActorKind.ASSISTANT,
      actorKey: 'assistant',
      actorLabel: 'Project Assistant',
      via: AgentVia.ASSISTANT,
      action: 'assistant.turn',
    });
    expect(id).toBe('evt-2');
    expect(create.mock.calls[0][0].data.workspaceId).toBe('ws-77');
  });
});

describe('AgentEventsService.getRoster', () => {
  it('rolls up per-agent counts, tokens, cost, billable cost, project count + totals', async () => {
    const tx = {
      agentEvent: {
        groupBy: jest.fn(async (args: any) => {
          if (args.where?.billable === true) {
            return [{ actorKey: 'pat-1', _sum: { costUsd: '0.50' } }];
          }
          if (args.by?.includes('projectId')) {
            return [
              { actorKey: 'pat-1', projectId: 'p1', _count: { _all: 2 } },
              { actorKey: 'pat-1', projectId: 'p2', _count: { _all: 1 } },
              { actorKey: 'assistant', projectId: 'p1', _count: { _all: 5 } },
            ];
          }
          // primary roster groupBy (by actorKey)
          return [
            {
              actorKey: 'pat-1',
              _count: { _all: 3 },
              _sum: { tokensIn: null, tokensOut: null, costUsd: '1.250000' },
              _max: { occurredAt: new Date('2026-06-10T00:00:00Z') },
            },
            {
              actorKey: 'assistant',
              _count: { _all: 5 },
              _sum: { tokensIn: 1000, tokensOut: 400, costUsd: '0.030000' },
              _max: { occurredAt: new Date('2026-06-12T00:00:00Z') },
            },
          ];
        }),
        findMany: jest.fn(async () => [
          {
            actorKey: 'assistant',
            actorLabel: 'Project Assistant',
            actorKind: AgentActorKind.ASSISTANT,
            via: AgentVia.ASSISTANT,
          },
          {
            actorKey: 'pat-1',
            actorLabel: 'Claude Code',
            actorKind: AgentActorKind.PAT,
            via: AgentVia.MCP,
          },
        ]),
      },
    };
    const { svc } = makeService(tx);
    const res = await svc.getRoster('ws-1', admin);

    // Sorted by eventCount desc → assistant (5) first.
    expect(res.agents.map((a) => a.actorKey)).toEqual(['assistant', 'pat-1']);
    const pat = res.agents.find((a) => a.actorKey === 'pat-1')!;
    expect(pat).toMatchObject({
      actorLabel: 'Claude Code',
      actorKind: AgentActorKind.PAT,
      eventCount: 3,
      costUsd: 1.25,
      billableCostUsd: 0.5,
      projectCount: 2,
      lastActiveAt: '2026-06-10T00:00:00.000Z',
    });
    const assistant = res.agents.find((a) => a.actorKey === 'assistant')!;
    expect(assistant).toMatchObject({
      tokensIn: 1000,
      tokensOut: 400,
      costUsd: 0.03,
      projectCount: 1,
      billableCostUsd: 0,
    });

    expect(res.totals).toEqual({
      agentCount: 2,
      eventCount: 8,
      tokensIn: 1000,
      tokensOut: 400,
      costUsd: 1.28,
    });
  });
});

describe('AgentEventsService.getActivity', () => {
  it('returns serialized rows (Decimal→number, ISO dates) + total, windowed/paged', async () => {
    const findMany = jest.fn(async (_args: any) => [
      {
        id: 'e1',
        occurredAt: new Date('2026-06-12T08:00:00Z'),
        actorKey: 'pat-1',
        actorLabel: 'Claude Code',
        actorKind: AgentActorKind.PAT,
        via: AgentVia.MCP,
        action: 'create_task',
        resource: 'task',
        resourceId: 't1',
        projectId: 'p1',
        taskId: 't1',
        tokensIn: null,
        tokensOut: null,
        costUsd: '0.000000',
        durationMs: 42,
        billable: false,
      },
    ]);
    const count = jest.fn(async () => 1);
    const tx = { agentEvent: { findMany, count } };
    const { svc } = makeService(tx);

    const res = await svc.getActivity('ws-1', admin, { limit: 50, offset: 0 });
    expect(res.total).toBe(1);
    expect(res.data[0]).toEqual({
      id: 'e1',
      occurredAt: '2026-06-12T08:00:00.000Z',
      actorKey: 'pat-1',
      actorLabel: 'Claude Code',
      actorKind: AgentActorKind.PAT,
      via: AgentVia.MCP,
      action: 'create_task',
      resource: 'task',
      resourceId: 't1',
      projectId: 'p1',
      taskId: 't1',
      tokensIn: null,
      tokensOut: null,
      costUsd: 0,
      durationMs: 42,
      billable: false,
    });
    // paging threaded into the query
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 50 });
  });

  it('applies actorKey/projectId/via filters in the where clause', async () => {
    const findMany = jest.fn(async (_args: any) => []);
    const count = jest.fn(async () => 0);
    const tx = { agentEvent: { findMany, count } };
    const { svc } = makeService(tx);
    await svc.getActivity('ws-1', admin, {
      actorKey: 'pat-1',
      projectId: 'p1',
      via: AgentVia.MCP,
      limit: 10,
      offset: 5,
    });
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ actorKey: 'pat-1', projectId: 'p1', via: AgentVia.MCP });
    expect(where.occurredAt).toHaveProperty('gte');
  });
});

describe('AgentEventsService.getUsage', () => {
  it('returns byAgent rollup, a contiguous series, totals and the period', async () => {
    const tx = {
      agentEvent: {
        groupBy: jest.fn(async () => [
          {
            actorKey: 'assistant',
            _count: { _all: 2 },
            _sum: { tokensIn: 100, tokensOut: 50, costUsd: '0.020000' },
          },
        ]),
        findMany: jest.fn(async (args: any) => {
          // label rows include actorLabel; series rows include occurredAt+costUsd
          if (args.select?.actorLabel) {
            return [{ actorKey: 'assistant', actorLabel: 'Project Assistant' }];
          }
          return [
            { occurredAt: new Date('2026-06-10T01:00:00Z'), costUsd: '0.010000' },
            { occurredAt: new Date('2026-06-10T05:00:00Z'), costUsd: '0.010000' },
          ];
        }),
      },
    };
    const { svc } = makeService(tx);
    const res = await svc.getUsage('ws-1', admin, '2026-06-09T00:00:00Z', '2026-06-11T00:00:00Z');

    expect(res.byAgent).toEqual([
      {
        actorKey: 'assistant',
        actorLabel: 'Project Assistant',
        eventCount: 2,
        tokensIn: 100,
        tokensOut: 50,
        costUsd: 0.02,
      },
    ]);
    expect(res.totals).toEqual({ eventCount: 2, tokensIn: 100, tokensOut: 50, costUsd: 0.02 });
    expect(res.period).toEqual({
      from: '2026-06-09T00:00:00.000Z',
      to: '2026-06-11T00:00:00.000Z',
    });
    // daily series across a 2–3 day window, both events on the 10th bucket.
    const tenth = res.series.find((s) => s.label === '2026-06-10');
    expect(tenth).toEqual({ label: '2026-06-10', eventCount: 2, costUsd: 0.02 });
    expect(res.series.length).toBeGreaterThanOrEqual(2);
  });
});

describe('AgentEventsService.getAgent', () => {
  it('404s when the agent has never been seen', async () => {
    const tx = {
      agentEvent: {
        findFirst: jest.fn(async () => null),
        aggregate: jest.fn(async () => ({
          _min: { occurredAt: null },
          _max: { occurredAt: null },
        })),
      },
    };
    const { svc } = makeService(tx);
    await expect(svc.getAgent('ws-1', admin, 'nope')).rejects.toThrow(/No agent activity/);
  });

  it('assembles identity, window totals, by-project (names resolved), series, recent', async () => {
    const tx = {
      agentEvent: {
        findFirst: jest.fn(async () => ({
          actorKey: 'pat-1',
          actorLabel: 'Claude Code',
          actorKind: AgentActorKind.PAT,
          via: AgentVia.MCP,
        })),
        aggregate: jest.fn(async (args: any) => {
          if (args._min) {
            return {
              _min: { occurredAt: new Date('2026-06-01T00:00:00Z') },
              _max: { occurredAt: new Date('2026-06-12T00:00:00Z') },
            };
          }
          return {
            _count: { _all: 4 },
            _sum: { tokensIn: null, tokensOut: null, costUsd: '0.000000' },
          };
        }),
        groupBy: jest.fn(async () => [
          { projectId: 'p1', _count: { _all: 3 }, _sum: { costUsd: '0.000000' } },
        ]),
        findMany: jest.fn(async (args: any) => {
          if (args.select?.occurredAt && args.select?.costUsd && !args.orderBy) {
            return [{ occurredAt: new Date('2026-06-11T00:00:00Z'), costUsd: '0.000000' }];
          }
          // recent rows
          return [
            {
              id: 'e9',
              occurredAt: new Date('2026-06-11T00:00:00Z'),
              actorKey: 'pat-1',
              actorLabel: 'Claude Code',
              actorKind: AgentActorKind.PAT,
              via: AgentVia.MCP,
              action: 'update_task',
              resource: 'task',
              resourceId: 't9',
              projectId: 'p1',
              taskId: 't9',
              tokensIn: null,
              tokensOut: null,
              costUsd: '0.000000',
              durationMs: 10,
              billable: false,
            },
          ];
        }),
      },
      project: {
        findMany: jest.fn(async () => [
          { id: 'p1', title: 'Acme Redesign', projectNumber: 'PROJ-1' },
        ]),
      },
    };
    const { svc } = makeService(tx);
    const res = await svc.getAgent('ws-1', admin, 'pat-1');

    expect(res.agent).toMatchObject({
      actorKey: 'pat-1',
      actorLabel: 'Claude Code',
      firstSeenAt: '2026-06-01T00:00:00.000Z',
      lastActiveAt: '2026-06-12T00:00:00.000Z',
    });
    expect(res.totals.eventCount).toBe(4);
    expect(res.byProject).toEqual([
      { projectId: 'p1', projectName: 'Acme Redesign', eventCount: 3, costUsd: 0 },
    ]);
    expect(res.recent[0]).toMatchObject({ id: 'e9', action: 'update_task', costUsd: 0 });
    expect(Array.isArray(res.series)).toBe(true);
  });
});

describe('AgentEventsService.setBillable (billing hook)', () => {
  it('flags an existing event and returns the serialized row', async () => {
    const update = jest.fn(async () => ({
      id: 'e1',
      occurredAt: new Date('2026-06-12T00:00:00Z'),
      actorKey: 'pat-1',
      actorLabel: 'Claude Code',
      actorKind: AgentActorKind.PAT,
      via: AgentVia.MCP,
      action: 'create_task',
      resource: 'task',
      resourceId: 't1',
      projectId: 'p1',
      taskId: 't1',
      tokensIn: null,
      tokensOut: null,
      costUsd: '0.250000',
      durationMs: 5,
      billable: true,
    }));
    const tx = { agentEvent: { findUnique: jest.fn(async () => ({ id: 'e1' })), update } };
    const { svc } = makeService(tx);
    const res = await svc.setBillable('ws-1', admin, 'e1', true);
    expect(update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { billable: true } });
    expect(res).toMatchObject({ id: 'e1', billable: true, costUsd: 0.25 });
  });

  it('404s when the id is not visible in the workspace (RLS)', async () => {
    const tx = { agentEvent: { findUnique: jest.fn(async () => null), update: jest.fn() } };
    const { svc } = makeService(tx);
    await expect(svc.setBillable('ws-1', admin, 'missing', true)).rejects.toThrow(/not found/);
  });
});

describe('AgentEventsService pure helpers', () => {
  it('resolveWindow defaults to a trailing 30-day window and validates order', () => {
    const now = new Date('2026-06-19T00:00:00Z');
    const svc = new AgentEventsService({} as any, {} as any);
    const w = svc.resolveWindow(undefined, undefined, now);
    expect(w.to.toISOString()).toBe('2026-06-19T00:00:00.000Z');
    expect(w.from.toISOString()).toBe('2026-05-20T00:00:00.000Z');
    expect(() => svc.resolveWindow('2026-06-10', '2026-06-01')).toThrow(/on or before/);
  });

  it('buildSeries emits contiguous daily buckets with zero-fill', () => {
    const window = { from: new Date('2026-06-10T00:00:00Z'), to: new Date('2026-06-12T00:00:00Z') };
    const series = AgentEventsService.buildSeries(window, [
      { occurredAt: new Date('2026-06-10T03:00:00Z'), costUsd: 0.01 },
      { occurredAt: new Date('2026-06-12T03:00:00Z'), costUsd: 0.02 },
    ]);
    const byLabel = Object.fromEntries(series.map((s) => [s.label, s]));
    expect(byLabel['2026-06-10']).toEqual({ label: '2026-06-10', eventCount: 1, costUsd: 0.01 });
    expect(byLabel['2026-06-11']).toEqual({ label: '2026-06-11', eventCount: 0, costUsd: 0 }); // zero-filled gap
    expect(byLabel['2026-06-12']).toEqual({ label: '2026-06-12', eventCount: 1, costUsd: 0.02 });
  });
});
