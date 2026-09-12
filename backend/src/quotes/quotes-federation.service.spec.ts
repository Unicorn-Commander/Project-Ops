import { HttpException } from '@nestjs/common';
import { QuotesFederationService } from './quotes-federation.service';
import { QuoteAcceptedDto } from './dto/quote-accepted.dto';
import { PROJECT_CREATED_EVENT } from '../projects/projects.service';

/**
 * The quote.accepted adapter against a hand-rolled in-memory tx (suite style:
 * workspaceContext.runInWorkspace invokes the callback with a fake tx, so the
 * real method bodies run without a DB). Fixtures are synthetic; the customer is
 * "the apparel client".
 */

const WS = 'ws-1';
const PDF_BYTES = Buffer.from('%PDF-1.7\n% synthetic accepted quote\n');
const PDF_B64 = PDF_BYTES.toString('base64');

const federationActor = {
  id: 'federation:customer-ops',
  __isFederationActor: true,
  __federationActor: 'customer-ops',
  __ucUid: 'svc-sub-uuid',
} as any;

const humanAdmin = { id: 'u-admin', role: 'ADMIN', keycloakId: 'kc-admin' } as any;

function payload(overrides: Partial<QuoteAcceptedDto> = {}): QuoteAcceptedDto {
  return {
    customer_ops_quote_id: 'q-0001',
    number: 'Q-2026-0001',
    version: 1,
    title: 'Order Pad for the apparel client',
    share_url: 'https://customers.example.dev/q/tok_synthetic',
    client_name: 'The apparel client',
    contact_id: 'contact-ok',
    currency: 'usd',
    billing: {
      one_time_total_cents: 140000,
      milestone_total_cents: 290000,
      deposit_cents: 215000,
      recurring: [
        { interval: 'month', amount_cents: 35000, label: 'Managed hosting' },
        { interval: 'year', amount_cents: 12000, label: 'AI allowance' },
      ],
      hourly_rate_cents: 15000,
      schedule_text: '50% on acceptance, 50% per milestone; hosting monthly in advance.',
      version_no: 1,
    },
    lines: [
      { kind: 'milestone', label: 'Milestone 2 — order pad on the floor', acceptance_criteria_md: 'M2 criteria', estimated_hours: 24, weeks: 2, position: 3 },
      { kind: 'one_time', label: 'Discovery + setup', acceptance_criteria_md: 'Setup criteria', estimated_hours: 8, position: 1 },
      { kind: 'option', label: 'Package: Pro', position: 2, option_group: 'package', selected: false },
      { kind: 'option', label: 'Package: Starter', position: 2, option_group: 'package', selected: true },
      { kind: 'recurring', label: 'Hosting', position: 5 },
      { kind: 'milestone', label: 'Milestone 1 — pilot', acceptance_criteria_md: 'M1 criteria', position: 2, customer_ops_line_id: 'line-m1' },
      { kind: 'excluded', label: 'Custom hardware', position: 6 },
    ],
    pdf: { base64: PDF_B64, file_name: 'Q-2026-0001-v1.pdf' },
    accepted_at: '2026-09-12T18:04:00Z',
    ...overrides,
  } as QuoteAcceptedDto;
}

/** In-memory stand-in for the workspace tx, honouring the JSON-path filters the service uses. */
function makeTx() {
  const state = { projects: [] as any[], tasks: [] as any[], documents: [] as any[], users: [] as any[] };
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    project: {
      findFirst: jest.fn(async ({ where }: any) => {
        const [idF, verF] = where.AND;
        return (
          state.projects.find(
            (p) =>
              p.workspaceId === where.workspaceId &&
              p.metadata?.quote?.customer_ops_quote_id === idF.metadata.equals &&
              p.metadata?.quote?.version === verF.metadata.equals,
          ) ?? null
        );
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `p${state.projects.length + 1}`, createdAt: new Date(), ...data };
        state.projects.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.projects.find((p) => p.id === where.id);
        Object.assign(row, data);
        return row;
      }),
    },
    task: {
      findMany: jest.fn(async ({ where }: any) =>
        state.tasks.filter(
          (t) => t.projectId === where.projectId && t.metadata?.quote?.customer_ops_quote_id === where.metadata.equals,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `t${state.tasks.length + 1}`, createdAt: new Date(1_000 + state.tasks.length), ...data };
        state.tasks.push(row);
        return row;
      }),
    },
    document: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          state.documents.find(
            (d) => d.projectId === where.projectId && d.metadata?.quote?.customer_ops_quote_id === where.metadata.equals,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `d${state.documents.length + 1}`, ...data };
        state.documents.push(row);
        return { id: row.id };
      }),
    },
    user: {
      upsert: jest.fn(async ({ create }: any) => {
        let u = state.users.find((x) => x.username === create.username);
        if (!u) {
          u = { id: 'svc-user', ...create };
          state.users.push(u);
        }
        return { id: u.id };
      }),
    },
    contact: {
      findFirst: jest.fn(async ({ where }: any) =>
        where.id === 'contact-ok' && where.workspaceId === WS ? { id: 'contact-ok' } : null,
      ),
    },
  };
  return { tx, state };
}

function makeService(opts: { fetchImpl?: any } = {}) {
  const { tx, state } = makeTx();
  const workspaceContext = {
    runInWorkspace: jest.fn(async (_ws: string, _uid: string, fn: (t: any) => any) => fn(tx)),
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };
  let n = 0;
  const projectsService = {
    nextProjectNumber: jest.fn(async () => `PROJ-2026-${String(++n).padStart(6, '0')}`),
  };
  const minio = {
    uploadObject: jest.fn(async () => ({ etag: 'x' })),
    getBucketName: () => 'project-ops-documents',
  };
  const audit = { log: jest.fn(async () => null) };
  const emitter = { emit: jest.fn() };
  const svc = new QuotesFederationService(
    workspaceContext as any,
    projectsService as any,
    minio as any,
    audit as any,
    emitter as any,
  );
  if (opts.fetchImpl) svc.useFetch(opts.fetchImpl);
  return { svc, tx, state, workspaceContext, projectsService, minio, audit, emitter };
}

describe('QuotesFederationService.acceptQuote — first acceptance', () => {
  it('creates the project with the contract billing fields + metadata, tasks in order, and the PDF document', async () => {
    const { svc, state, tx, minio, audit, emitter } = makeService();

    const result = await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });

    // Response contract (A7): done + created + the ids.
    expect(result).toEqual({
      status: 'done',
      created: true,
      project_id: 'p1',
      project_number: 'PROJ-2026-000001',
      task_ids: ['t1', 't2', 't3'],
      document_id: 'd1',
      contact_linked: true,
      schedule_ids: [],
      quote: { customer_ops_quote_id: 'q-0001', number: 'Q-2026-0001', version: 1 },
    });

    // Project row.
    const project = state.projects[0];
    expect(project.workspaceId).toBe(WS);
    expect(project.title).toBe('Order Pad for the apparel client');
    expect(project.clientName).toBe('The apparel client');
    expect(project.contactId).toBe('contact-ok');
    expect(project.createdById).toBe('svc-user'); // the deterministic federation service user
    expect(project.billingAmount).toBe('4300.00'); // 1400.00 + 2900.00, integer cents → decimal string
    expect(project.budgetAmount).toBe('4300.00');
    expect(project.defaultBillRate).toBe('150.00'); // hourly.primary rate only (A14)
    expect(project.billingNotes).toBe(
      'Quote Q-2026-0001 v1: 50% on acceptance, 50% per milestone; hosting monthly in advance.',
    );
    expect(project.metadata.quote).toEqual({
      customer_ops_quote_id: 'q-0001',
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok_synthetic',
      schedule_ids: [],
    });
    expect(project.metadata.quoteSummary).toEqual({
      title: 'Order Pad for the apparel client',
      currency: 'USD',
      status: 'accepted',
      // 35000/mo + 12000/yr → 35000 + round(12000/12) = 36000 (A4/A8 blend).
      totals: { one_time_total_cents: 140000, milestone_total_cents: 290000, recurring_monthly_cents: 36000 },
    });
    // Nothing internal ever lands on the project (§2.6, A3).
    expect(JSON.stringify(project.metadata)).not.toMatch(/internal|split|cost/i);

    // Tasks: accepted one_time + milestone lines only, ascending position (A16).
    expect(state.tasks.map((t) => t.title)).toEqual([
      'Discovery + setup',
      'Milestone 1 — pilot',
      'Milestone 2 — order pad on the floor',
    ]);
    for (const t of state.tasks) {
      expect(t.type).toBe('TASK');
      expect(t.status).toBe('PENDING');
      expect(t.projectId).toBe('p1');
      expect(t.workspaceId).toBe(WS);
      expect(t.createdById).toBe('svc-user');
      expect(t.metadata.quote.customer_ops_quote_id).toBe('q-0001');
    }
    expect(state.tasks[0].description).toBe('Setup criteria');
    expect(state.tasks[0].estimatedHours).toBe(8);
    expect(state.tasks[1].estimatedHours).toBeNull();
    expect(state.tasks[1].metadata.quote.customer_ops_line_id).toBe('line-m1');
    expect(state.tasks[2].estimatedHours).toBe(24);
    expect(state.tasks[2].metadata.quote.weeks).toBe(2);

    // The accepted PDF: stored OUTSIDE the tx under a deterministic key, then a Document row.
    expect(minio.uploadObject).toHaveBeenCalledTimes(1);
    const [key, bytes, size, meta] = (minio.uploadObject as jest.Mock).mock.calls[0];
    expect(key).toBe('quotes/ws-1/q-0001/v1/Q-2026-0001-v1.pdf');
    expect(Buffer.isBuffer(bytes) && bytes.equals(PDF_BYTES)).toBe(true);
    expect(size).toBe(PDF_BYTES.length);
    expect(meta).toEqual({ 'Content-Type': 'application/pdf' });
    const doc = state.documents[0];
    expect(doc).toMatchObject({
      workspaceId: WS,
      projectId: 'p1',
      uploadedById: 'svc-user',
      fileName: 'Q-2026-0001-v1.pdf',
      fileSize: PDF_BYTES.length,
      mimeType: 'application/pdf',
      s3Key: 'quotes/ws-1/q-0001/v1/Q-2026-0001-v1.pdf',
      s3Bucket: 'project-ops-documents',
      status: 'UPLOADED',
    });

    // Serialised per (workspace, quote, version) with a pg advisory lock inside the write tx.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);

    // Audit + domain events (after commit), like the interactive create paths.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: WS, userId: 'svc-user', action: 'CREATE', resource: 'Project', resourceId: 'p1' }),
    );
    expect(emitter.emit).toHaveBeenCalledWith(
      PROJECT_CREATED_EVENT,
      expect.objectContaining({ workspaceId: WS, projectId: 'p1', actorId: 'svc-user' }),
    );
    expect(emitter.emit.mock.calls.filter((c) => c[0] === 'task.created')).toHaveLength(3);
  });

  it('upserts the service user once (no login, reserved .invalid email) and never uses the synthetic principal id as an FK', async () => {
    const { svc, tx, state } = makeService();
    await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });
    expect(tx.user.upsert).toHaveBeenCalledTimes(1);
    const create = (tx.user.upsert as jest.Mock).mock.calls[0][0].create;
    expect(create).toMatchObject({
      username: 'federation:customer-ops',
      email: 'customer-ops@federation.invalid',
      password: null,
      isActive: true,
      role: 'STAFF',
      weeklyCapacityHours: 0,
    });
    expect(state.projects[0].createdById).not.toBe('federation:customer-ops');
  });

  it('attributes to the acting human when there is no federation actor (service-level path)', async () => {
    const { svc, tx, state } = makeService();
    await svc.acceptQuote(WS, humanAdmin, payload(), { federationActor: null });
    expect(tx.user.upsert).not.toHaveBeenCalled();
    expect(state.projects[0].createdById).toBe('u-admin');
  });

  it('leaves the contact unlinked (not an error) when contact_id does not resolve in the workspace', async () => {
    const { svc, state } = makeService();
    const result = await svc.acceptQuote(WS, federationActor, payload({ contact_id: 'contact-from-elsewhere' }), {
      federationActor: 'customer-ops',
    });
    expect(result.contact_linked).toBe(false);
    expect(state.projects[0].contactId).toBeNull();
    expect(JSON.stringify(state.projects[0].metadata)).not.toContain('contact-from-elsewhere');
  });

  it('omits defaultBillRate when the quote has no hourly line', async () => {
    const { svc, state } = makeService();
    const p = payload();
    delete (p.billing as any).hourly_rate_cents;
    await svc.acceptQuote(WS, federationActor, p, { federationActor: 'customer-ops' });
    expect(state.projects[0].defaultBillRate).toBeNull();
  });

  it('creates no document when the payload carries no pdf', async () => {
    const { svc, state, minio } = makeService();
    const result = await svc.acceptQuote(WS, federationActor, payload({ pdf: undefined }), {
      federationActor: 'customer-ops',
    });
    expect(result.document_id).toBeNull();
    expect(state.documents).toHaveLength(0);
    expect(minio.uploadObject).not.toHaveBeenCalled();
  });
});

describe('QuotesFederationService.acceptQuote — idempotency by (quote id, version)', () => {
  it('a second call returns the SAME ids, creates nothing, uploads nothing, emits nothing', async () => {
    const { svc, state, minio, emitter, tx } = makeService();
    const first = await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });
    emitter.emit.mockClear();

    const second = await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });

    expect(second).toEqual({ ...first, created: false });
    expect(state.projects).toHaveLength(1);
    expect(state.tasks).toHaveLength(3);
    expect(state.documents).toHaveLength(1);
    expect(minio.uploadObject).toHaveBeenCalledTimes(1);
    expect(tx.project.create).toHaveBeenCalledTimes(1);
    expect(tx.project.update).not.toHaveBeenCalled();
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('a different version of the same quote is a distinct federation (contract: keyed by id + version)', async () => {
    const { svc, state } = makeService();
    await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });
    const v2 = await svc.acceptQuote(
      WS,
      federationActor,
      payload({ version: 2, billing: { ...payload().billing, version_no: 2 } }),
      { federationActor: 'customer-ops' },
    );
    expect(v2.created).toBe(true);
    expect(v2.project_id).toBe('p2');
    expect(state.projects).toHaveLength(2);
  });

  it('never matches a project from another workspace (explicit workspaceId AND in the lookup)', async () => {
    const { svc, state, tx } = makeService();
    await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });
    const other = await svc.acceptQuote('ws-2', federationActor, payload(), { federationActor: 'customer-ops' });
    expect(other.created).toBe(true);
    expect(state.projects).toHaveLength(2);
    const where = (tx.project.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where.workspaceId).toBe(WS);
    expect(where.AND).toEqual([
      { metadata: { path: ['quote', 'customer_ops_quote_id'], equals: 'q-0001' } },
      { metadata: { path: ['quote', 'version'], equals: 1 } },
    ]);
  });

  it('merges schedule_ids idempotently on later calls (A14) and only writes when they change', async () => {
    const { svc, state, tx } = makeService();
    const r1 = await svc.acceptQuote(WS, federationActor, payload({ schedule_ids: ['sched-deposit'] }), {
      federationActor: 'customer-ops',
    });
    expect(r1.schedule_ids).toEqual(['sched-deposit']);

    const r2 = await svc.acceptQuote(
      WS,
      federationActor,
      payload({ schedule_ids: ['sched-m1', 'sched-deposit', 'sched-m2'] }),
      { federationActor: 'customer-ops' },
    );
    expect(r2.created).toBe(false);
    expect(r2.project_id).toBe(r1.project_id);
    expect(r2.schedule_ids).toEqual(['sched-deposit', 'sched-m1', 'sched-m2']);
    expect(tx.project.update).toHaveBeenCalledTimes(1);
    expect(state.projects[0].metadata.quote.schedule_ids).toEqual(['sched-deposit', 'sched-m1', 'sched-m2']);
    // Other metadata keys survive the merge.
    expect(state.projects[0].metadata.quoteSummary.title).toBe('Order Pad for the apparel client');

    const r3 = await svc.acceptQuote(
      WS,
      federationActor,
      payload({ schedule_ids: ['sched-m2', 'sched-deposit'] }),
      { federationActor: 'customer-ops' },
    );
    expect(r3.schedule_ids).toEqual(['sched-deposit', 'sched-m1', 'sched-m2']);
    expect(tx.project.update).toHaveBeenCalledTimes(1); // unchanged → no write
  });

  it('a replay that carries the PDF attaches it once when the first call had none', async () => {
    const { svc, state, minio } = makeService();
    const r1 = await svc.acceptQuote(WS, federationActor, payload({ pdf: undefined }), { federationActor: 'customer-ops' });
    expect(r1.document_id).toBeNull();

    const r2 = await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });
    expect(r2.created).toBe(false);
    expect(r2.project_id).toBe(r1.project_id);
    expect(r2.document_id).toBe('d1');
    expect(state.documents).toHaveLength(1);
    expect(state.documents[0].uploadedById).toBe('svc-user');

    const r3 = await svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' });
    expect(r3.document_id).toBe('d1');
    expect(state.documents).toHaveLength(1);
    expect(minio.uploadObject).toHaveBeenCalledTimes(1);
  });
});

describe('QuotesFederationService.acceptQuote — failures are classified and create nothing', () => {
  async function expectFailure(run: () => Promise<unknown>, code: string, httpStatus: number) {
    let err: HttpException | undefined;
    try {
      await run();
    } catch (e) {
      err = e as HttpException;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect(err!.getStatus()).toBe(httpStatus);
    expect(err!.getResponse()).toMatchObject({ status: 'failed', code });
  }

  it('rejects a non-2-decimal currency (A17) before touching the DB', async () => {
    const { svc, tx, state } = makeService();
    await expectFailure(
      () => svc.acceptQuote(WS, federationActor, payload({ currency: 'JPY' }), { federationActor: 'customer-ops' }),
      'UNSUPPORTED_CURRENCY',
      400,
    );
    expect(tx.project.create).not.toHaveBeenCalled();
    expect(state.projects).toHaveLength(0);
  });

  it('rejects a billing block computed from another version (VERSION_MISMATCH)', async () => {
    const { svc, state } = makeService();
    await expectFailure(
      () =>
        svc.acceptQuote(WS, federationActor, payload({ billing: { ...payload().billing, version_no: 2 } }), {
          federationActor: 'customer-ops',
        }),
      'VERSION_MISMATCH',
      400,
    );
    expect(state.projects).toHaveLength(0);
  });

  it('rejects bytes that are not a PDF (PDF_INVALID) — no upload, no project', async () => {
    const { svc, state, minio } = makeService();
    await expectFailure(
      () =>
        svc.acceptQuote(
          WS,
          federationActor,
          payload({ pdf: { base64: Buffer.from('<html>not a pdf</html>').toString('base64'), file_name: 'x.pdf' } }),
          { federationActor: 'customer-ops' },
        ),
      'PDF_INVALID',
      422,
    );
    expect(minio.uploadObject).not.toHaveBeenCalled();
    expect(state.projects).toHaveLength(0);
  });

  it('fetches pdf.url and stores it; a failed fetch is PDF_FETCH_FAILED with nothing created', async () => {
    const okFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(PDF_BYTES.length) },
      arrayBuffer: async () => PDF_BYTES.buffer.slice(PDF_BYTES.byteOffset, PDF_BYTES.byteOffset + PDF_BYTES.length),
    }));
    const { svc, state, minio } = makeService({ fetchImpl: okFetch });
    const r = await svc.acceptQuote(
      WS,
      federationActor,
      payload({ pdf: { url: 'https://customers.example.dev/api/quotes/q-0001/versions/1/pdf', file_name: 'q.pdf' } }),
      { federationActor: 'customer-ops' },
    );
    expect(okFetch).toHaveBeenCalledWith(
      'https://customers.example.dev/api/quotes/q-0001/versions/1/pdf',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(r.document_id).toBe('d1');
    expect(minio.uploadObject).toHaveBeenCalledTimes(1);
    expect(state.documents[0].fileName).toBe('q.pdf');

    const badFetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const failing = makeService({ fetchImpl: badFetch });
    await expectFailure(
      () =>
        failing.svc.acceptQuote(
          WS,
          federationActor,
          payload({ pdf: { url: 'https://customers.example.dev/pdf', file_name: 'q.pdf' } }),
          { federationActor: 'customer-ops' },
        ),
      'PDF_FETCH_FAILED',
      502,
    );
    expect(failing.state.projects).toHaveLength(0);
    expect(failing.minio.uploadObject).not.toHaveBeenCalled();
  });

  it('surfaces an object-store failure as PDF_STORE_FAILED (503) with no project created', async () => {
    const { svc, state, minio } = makeService();
    (minio.uploadObject as jest.Mock).mockRejectedValueOnce(new Error('minio down'));
    await expectFailure(
      () => svc.acceptQuote(WS, federationActor, payload(), { federationActor: 'customer-ops' }),
      'PDF_STORE_FAILED',
      503,
    );
    expect(state.projects).toHaveLength(0);
  });
});
