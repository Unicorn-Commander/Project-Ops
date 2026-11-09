import { TriageService } from './triage.service';
import { TriageAction, TriageReasonPreset } from './dto/triage-proposals.dto';

describe('TriageService ingest resilience', () => {
  const user = { id: 'user-1' } as any;

  function makeService(options: { useOrgRoute?: boolean; provider?: any } = {}) {
    const tx = {
      project: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'project-1', projectNumber: 'P-00001', title: 'Test project', description: null },
          ]),
      },
      triageProposal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
    } as any;
    const workspaceContext = {
      assertCanWrite: jest.fn(),
      runForUser: jest.fn((_user, callback) => callback(tx)),
      runInWorkspace: jest.fn((_workspaceId, _userId, callback) => callback(tx)),
    } as any;
    const config = {
      get: jest.fn(
        (key: string, fallback: string) =>
          ({
            INFINITY_EMBEDDINGS_URL: 'http://embed.test:8080',
            INFINITY_RERANK_URL: 'http://rerank.test:8080',
            QWEN_URL: 'http://qwen.test:8080/v1/chat/completions',
            PROJECT_OPS_USE_ORG_ROUTE: options.useOrgRoute ? 'true' : 'false',
            ORG_GATEWAY_BASE_URL: 'https://gateway.fictional.example/v1',
          })[key] ?? fallback,
      ),
    } as any;
    const tasks = { createInTx: jest.fn() };
    const service = new TriageService(
      config,
      {} as any,
      workspaceContext,
      {} as any,
      tasks as any,
      options.provider,
    );
    jest.spyOn(service as any, 'rerank').mockResolvedValue([]);
    jest.spyOn(service as any, 'qwenDecide').mockResolvedValue({
      keep: true,
      project: 'NONE',
      title: 'Do thing',
      pri: 'MEDIUM',
    });
    return { service, tx, tasks };
  }

  it('creates a proposal and warns once when embedding fails', async () => {
    const { service, tx } = makeService();
    jest.spyOn(service as any, 'embed').mockRejectedValue(new Error('connection refused'));
    const warn = jest.spyOn((service as any).logger, 'warn');

    const result = await service.ingestCandidates('ws-1', user, [{ text: 'Do thing' }]);

    expect(result.created).toBe(1);
    expect(tx.triageProposal.create).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('triage: embeddings degraded host=http://embed.test:8080'),
    );
    expect(
      warn.mock.calls.filter(([message]) => String(message).includes('embeddings degraded')),
    ).toHaveLength(1);
  });

  it('keeps the working embedding path unchanged', async () => {
    const { service, tx } = makeService();
    jest.spyOn(service as any, 'embed').mockResolvedValue([[1, 0]]);
    const warn = jest.spyOn((service as any).logger, 'warn');

    const result = await service.ingestCandidates('ws-1', user, [{ text: 'Do thing' }]);

    expect(result.created).toBe(1);
    expect(tx.triageProposal.create).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('TriageService org gateway routing', () => {
  const user = { id: 'user-1' } as any;

  function response(body: unknown, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }

  function makeRouteService(provider: any) {
    const tx = {
      project: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'project-1', projectNumber: 'P-00001', title: 'Test project', description: null },
          ]),
      },
      triageProposal: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'proposal-1' }),
      },
    } as any;
    const workspaceContext = {
      assertCanWrite: jest.fn(),
      runForUser: jest.fn((_user: any, callback: any) => callback(tx)),
    } as any;
    const config = {
      get: jest.fn(
        (key: string, fallback?: unknown) =>
          ({
            PROJECT_OPS_USE_ORG_ROUTE: 'true',
            ORG_GATEWAY_BASE_URL: 'https://gateway.fictional.example/v1',
            INFINITY_EMBEDDINGS_URL: 'http://embed.test:8080',
            INFINITY_RERANK_URL: 'http://rerank.test:8080',
            QWEN_URL: 'http://qwen.test:8080/v1/chat/completions',
          })[key] ?? fallback,
      ),
    } as any;
    const service = new TriageService(
      config,
      {} as any,
      workspaceContext,
      {} as any,
      {} as any,
      provider,
    );
    return { service, tx };
  }

  it('sends all triage inference through bare org routes with the org key and headers', async () => {
    const provider = {
      getKey: jest.fn().mockResolvedValue({
        key: 'fictional-org-key',
        expiresAt: Date.now() + 60_000,
      }),
    };
    const { service, tx } = makeRouteService(provider);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/embeddings')) return response({ data: [{ embedding: [1, 0] }] });
        if (url.endsWith('/rerank')) {
          return response({ results: [{ index: 0, relevance_score: 0.91 }] });
        }
        if (url.endsWith('/chat/completions')) {
          return response({
            choices: [
              { message: { content: '{"keep":true,"project":"NONE","title":"Do thing"}' } },
            ],
          });
        }
        return response({}, 404);
      });

    try {
      const result = await service.ingestCandidates('ws-1', user, [{ text: 'Do thing' }]);

      expect(result.created).toBe(1);
      expect(tx.triageProposal.create).toHaveBeenCalledTimes(1);
      expect(provider.getKey).toHaveBeenCalledWith('ws-1');
      expect(fetchMock).toHaveBeenCalledTimes(4);

      const calls = fetchMock.mock.calls;
      expect(
        calls.every(([input]) => String(input).startsWith('https://gateway.fictional.example/v1/')),
      ).toBe(true);
      expect(calls.some(([input]) => String(input).includes('embed.test'))).toBe(false);
      expect(calls.some(([input]) => String(input).includes('rerank.test'))).toBe(false);
      expect(calls.some(([input]) => String(input).includes('qwen.test'))).toBe(false);

      for (const [, init] of calls) {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer fictional-org-key',
          'X-UC-Org-Id': 'ws-1',
          'X-UC-App': 'project-ops',
          'X-UC-Feature': 'triage',
          'X-UC-User-Id': 'user-1',
        });
      }

      const bodies = calls.map(([, init]) => JSON.parse(String(init?.body)));
      expect(bodies.filter((body) => body.model === 'embed')).toHaveLength(3);
      expect(bodies.find((body) => body.messages)?.model).toBe('batch');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('returns a visible failed run and creates no proposals when the gateway fails', async () => {
    const provider = {
      getKey: jest.fn().mockResolvedValue({
        key: 'fictional-org-key',
        expiresAt: Date.now() + 60_000,
      }),
    };
    const { service, tx } = makeRouteService(provider);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(response({ error: 'gateway unavailable' }, 503));

    try {
      const result = await service.ingestCandidates('ws-1', user, [{ text: 'Do thing' }]);

      expect(result).toMatchObject({
        created: 0,
        proposals: [],
        status: 'FAILED',
        error: expect.stringContaining('gateway'),
        run: { status: 'FAILED', error: expect.stringContaining('gateway') },
      });
      expect(tx.triageProposal.create).not.toHaveBeenCalled();
      expect(
        fetchMock.mock.calls.every(([input]) =>
          String(input).startsWith('https://gateway.fictional.example/v1/'),
        ),
      ).toBe(true);
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('192.168.'))).toBe(
        false,
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('TriageService review decisions', () => {
  const user = { id: 'reviewer-1' } as any;

  function makeReviewService() {
    const tx = {
      triageProposal: {
        findUnique: jest.fn(),
        update: jest.fn(async ({ data }: any) => ({ ...data })),
      },
    } as any;
    const workspaceContext = {
      runForUser: jest.fn((_user, callback) => callback(tx)),
    } as any;
    const tasks = {
      createInTx: jest.fn(async () => ({ id: 'task-created-1' })),
    };
    const service = new TriageService(
      { get: jest.fn() } as any,
      {} as any,
      workspaceContext,
      {} as any,
      tasks as any,
    );
    return { service, tx, tasks };
  }

  it('approves into the explicit override and preserves the proposal text on the task', async () => {
    const { service, tx, tasks } = makeReviewService();
    tx.triageProposal.findUnique.mockResolvedValue({
      id: 'proposal-1',
      status: 'PENDING_REVIEW',
      proposedProjectId: 'agent-project',
      proposedTitle: 'Follow up with client',
      rawText: 'Send the client the revised scope.',
      proposedPriority: 'HIGH',
    });

    const result = await service.approve('workspace-1', user, 'proposal-1', 'project-override');
    expect(result).toEqual(expect.objectContaining({ status: 'APPLIED' }));
    expect(tasks.createInTx).toHaveBeenCalledWith(
      tx,
      'workspace-1',
      user,
      expect.objectContaining({
        projectId: 'project-override',
        title: 'Follow up with client',
        description: 'Send the client the revised scope.',
      }),
    );
  });

  it('rejects with preset and duplicate metadata in the stored reason text', async () => {
    const { service, tx } = makeReviewService();
    tx.triageProposal.findUnique.mockResolvedValue({
      id: 'proposal-2',
      status: 'PENDING_REVIEW',
    });

    await service.reject('workspace-1', user, 'proposal-2', {
      reasonPreset: TriageReasonPreset.DUPLICATE,
      duplicateOfTaskId: 'task-42',
      reason: 'Already tracked in the delivery board.',
    });

    expect(tx.triageProposal.update).toHaveBeenCalledWith({
      where: { id: 'proposal-2' },
      data: expect.objectContaining({
        status: 'REJECTED',
        reasonPreset: 'duplicate',
        duplicateOfTaskId: 'task-42',
        rejectionReason: expect.stringContaining('Duplicate of task task-42'),
      }),
    });
    expect(tx.triageProposal.update.mock.calls[0][0].data.rejectionReason).toEqual(
      expect.stringContaining('Preset: duplicate'),
    );
  });

  it('returns per-id results and continues after a missing proposal', async () => {
    const { service, tx } = makeReviewService();
    tx.triageProposal.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === 'missing') return null;
      return {
        id: where.id,
        status: 'PENDING_REVIEW',
        proposedProjectId: 'project-1',
        proposedTitle: 'Keep this item',
        rawText: 'Do the work.',
        proposedPriority: 'MEDIUM',
      };
    });

    const results = await service.applyDecisions('workspace-1', user, [
      {
        proposalId: 'proposal-1',
        action: TriageAction.APPROVE,
        targetProjectId: 'project-override',
      },
      { proposalId: 'missing', action: TriageAction.APPROVE },
      {
        proposalId: 'proposal-3',
        action: TriageAction.REJECT,
        reasonPreset: TriageReasonPreset.STALE,
      },
    ]);

    expect(results).toEqual([
      { id: 'proposal-1', ok: true, taskId: 'task-created-1' },
      { id: 'missing', ok: false, error: 'proposal not found' },
      { id: 'proposal-3', ok: true },
    ]);
  });

  it('rejects an approval when neither the override nor proposed project resolves', async () => {
    const { service, tx } = makeReviewService();
    tx.triageProposal.findUnique.mockResolvedValue({
      id: 'unassigned',
      status: 'PENDING_REVIEW',
      proposedProjectId: null,
      proposedTitle: 'Unassigned item',
      rawText: 'Needs a project.',
      proposedPriority: 'MEDIUM',
    });

    await expect(service.approve('workspace-1', user, 'unassigned')).rejects.toThrow(
      /no project resolved/,
    );
  });
});
