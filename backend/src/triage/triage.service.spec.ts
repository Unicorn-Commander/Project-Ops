import { TriageService } from './triage.service';

describe('TriageService ingest resilience', () => {
  const user = { id: 'user-1' } as any;

  function makeService() {
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
          })[key] ?? fallback,
      ),
    } as any;
    const service = new TriageService(config, {} as any, workspaceContext, {} as any, {} as any);
    jest.spyOn(service as any, 'rerank').mockResolvedValue([]);
    jest.spyOn(service as any, 'qwenDecide').mockResolvedValue({
      keep: true,
      project: 'NONE',
      title: 'Do thing',
      pri: 'MEDIUM',
    });
    return { service, tx };
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
