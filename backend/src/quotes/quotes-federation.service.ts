import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  DocumentStatus,
  Prisma,
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
  User,
  UserRole,
} from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { ucUidOf } from '../common/workspace/workspace.util';
import { MinioService } from '../documents/minio.service';
import { WorkspaceTxClient } from '../prisma/prisma.service';
import { PROJECT_CREATED_EVENT, ProjectsService } from '../projects/projects.service';
import { QuoteAcceptedDto, QuotePdfDto } from './dto/quote-accepted.dto';
import {
  QUOTE_FEDERATION_USER,
  QUOTE_PDF_MAX_BYTES,
  acceptLockKey,
  buildBillingNotes,
  buildQuoteRef,
  buildQuoteSummaryCache,
  buildTaskQuoteMetadata,
  centsToAmountString,
  federationError,
  looksLikePdf,
  mergeScheduleIds,
  normalizeCurrency,
  quotePdfObjectKey,
  safeFileName,
  scheduleIdsChanged,
  selectTaskLines,
  sortTasksByQuotePosition,
} from './quote-federation.util';

/** The per-call federation status Customer-Ops records (Amendment 01 A7). */
export interface QuoteAcceptedResult {
  status: 'done';
  /** true = this call created the project; false = idempotent replay (same ids returned). */
  created: boolean;
  project_id: string;
  project_number: string;
  /** In accepted-line order (position ascending). */
  task_ids: string[];
  document_id: string | null;
  /** Whether `contact_id` resolved to a Contact in the target workspace. */
  contact_linked: boolean;
  /** The merged Accounting-Ops schedule ids now stored on the project (A14). */
  schedule_ids: string[];
  quote: { customer_ops_quote_id: string; number: string; version: number };
}

interface ExistingFederation {
  project: Pick<Project, 'id' | 'projectNumber' | 'metadata' | 'contactId'>;
  tasks: Array<Pick<Task, 'id' | 'metadata' | 'createdAt'>>;
  document: { id: string } | null;
}

interface StoredPdf {
  s3Key: string;
  bucket: string;
  fileName: string;
  size: number;
}

interface TxOutcome {
  created: boolean;
  result: QuoteAcceptedResult;
  /** null on the replay path, which creates nothing and emits no events (L7). */
  creatorId: string | null;
  project: Project | null;
  tasks: Task[];
}

const PDF_FETCH_TIMEOUT_MS = 15_000;

/**
 * The Project-Ops half of `quote.accepted` (QUOTES-CONTRACT-v1 §3, Amendment 01
 * A7/A14/A16/A17): turn an accepted quote into a project, one task per accepted
 * `one_time`/`milestone` line, the billing fields, the accepted PDF as a
 * Document, and `metadata.quote` (ids only) + `metadata.quoteSummary` (the small
 * cached summary). Idempotent by (workspace, customer_ops_quote_id, version):
 * a replay returns the SAME ids, merges any new `schedule_ids`, and attaches the
 * PDF if it was missing — never a second project.
 *
 * Shape of a call:
 *   1. pre-check (short RLS tx)         — is this (quote, version) already here?
 *   2. PDF bytes → MinIO, OUTSIDE any tx — repo discipline (object store has no
 *      row tenancy; interactive-tx windows are short). Deterministic key, so a
 *      retry overwrites the same object.
 *   3. write tx under a pg advisory lock — re-check inside the lock, then create
 *      everything atomically or merge into the existing project.
 *   4. domain events after commit       — project.created / task.created, exactly
 *      like the interactive create paths, so automations + webhooks fire.
 *
 * Attribution: the federation principal is synthetic (no `users` row) while
 * `createdById` is a hard FK, so writes are attributed to the deterministic
 * non-login service user QUOTE_FEDERATION_USER (upserted lazily). The workspace
 * is the Brigade-vouched claim FederationActorGuard stamped — never a header.
 */
@Injectable()
export class QuotesFederationService {
  private readonly logger = new Logger(QuotesFederationService.name);

  /** Transport for `pdf.url` (class property, not a ctor param — see HttpCustomerOpsClient). */
  protected fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly projectsService: ProjectsService,
    private readonly minio: MinioService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  /** Test seam: swap the PDF transport. */
  useFetch(impl: typeof fetch): this {
    this.fetchImpl = impl;
    return this;
  }

  async acceptQuote(
    workspaceId: string,
    actor: User,
    dto: QuoteAcceptedDto,
    opts: { federationActor: string | null },
  ): Promise<QuoteAcceptedResult> {
    const currency = normalizeCurrency(dto.currency);
    if (dto.billing.version_no !== undefined && dto.billing.version_no !== dto.version) {
      throw federationError(
        HttpStatus.BAD_REQUEST,
        'VERSION_MISMATCH',
        `billing.version_no (${dto.billing.version_no}) must equal version (${dto.version}); the billing block must be computed from the accepted version.`,
      );
    }

    const ucUid = ucUidOf(actor);
    const quoteId = dto.customer_ops_quote_id;

    // 1. Pre-check — decides whether the PDF must be stored before the write tx.
    const pre = await this.workspaceContext.runInWorkspace(workspaceId, ucUid, (tx) =>
      this.findExisting(tx, workspaceId, quoteId, dto.version),
    );

    // 2. PDF → object store (outside any tx). Skipped on a replay that already has it.
    let stored: StoredPdf | null = null;
    if (dto.pdf && !pre?.document) {
      stored = await this.storePdf(workspaceId, dto, dto.pdf);
    }

    // 3. The write tx, serialised per (workspace, quote, version).
    const outcome = await this.workspaceContext.runInWorkspace(
      workspaceId,
      ucUid,
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${acceptLockKey(workspaceId, quoteId, dto.version)}::text))`;
        const existing = await this.findExisting(tx, workspaceId, quoteId, dto.version);
        if (existing) {
          return this.mergeIntoExisting(tx, workspaceId, actor, existing, dto, stored, opts);
        }
        await this.requireLiveWorkspace(tx, workspaceId);
        return this.createFederation(tx, workspaceId, actor, dto, currency, stored, opts);
      },
      { maxWait: 5_000, timeout: 20_000 },
    );

    // 4. Domain events AFTER commit (mirrors ProjectsService.create + TasksService.create).
    if (outcome.created && outcome.project) {
      this.eventEmitter.emit(PROJECT_CREATED_EVENT, {
        workspaceId,
        projectId: outcome.project.id,
        actorId: outcome.creatorId,
        project: outcome.project,
      });
      for (const task of outcome.tasks) {
        this.eventEmitter.emit('task.created', {
          workspaceId,
          taskId: task.id,
          projectId: task.projectId,
          actorId: outcome.creatorId,
          task,
        });
      }
    }

    this.logger.log(
      `quote.accepted ${dto.number} v${dto.version} → project ${outcome.result.project_number} ` +
        `(${outcome.created ? 'created' : 'replayed'}, ${outcome.result.task_ids.length} task(s), ` +
        `document=${outcome.result.document_id ?? 'none'}) actor=${opts.federationActor ?? actor.id} ws=${workspaceId}`,
    );
    return outcome.result;
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  /**
   * The project (+ its quote tasks and PDF document) already federated for this
   * (workspace, quote, version), or null. Filters on `metadata.quote.*` via
   * Prisma JSON path filters; `workspaceId` is ANDed explicitly so the
   * idempotency key can never match across workspaces even while RLS is inert.
   */
  private async findExisting(
    tx: WorkspaceTxClient,
    workspaceId: string,
    quoteId: string,
    version: number,
  ): Promise<ExistingFederation | null> {
    const project = await tx.project.findFirst({
      where: {
        workspaceId,
        AND: [
          { metadata: { path: ['quote', 'customer_ops_quote_id'], equals: quoteId } },
          { metadata: { path: ['quote', 'version'], equals: version } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, projectNumber: true, metadata: true, contactId: true },
    });
    if (!project) return null;

    const tasks = await tx.task.findMany({
      where: {
        projectId: project.id,
        metadata: { path: ['quote', 'customer_ops_quote_id'], equals: quoteId },
      },
      select: { id: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const document = await tx.document.findFirst({
      where: {
        projectId: project.id,
        metadata: { path: ['quote', 'customer_ops_quote_id'], equals: quoteId },
      },
      select: { id: true },
      orderBy: { uploadedAt: 'asc' },
    });

    return { project, tasks: sortTasksByQuotePosition(tasks), document };
  }

  /**
   * The vouched `workspace_id` claim steers, but nothing downstream proves the
   * workspace is real: `Project.workspaceId` carries no FK to `workspaces`
   * (unlike `Membership`), so a typo'd or stale claim would create a live
   * project row under an id RLS then hides from every human — a silent orphan
   * (M3). One query converts that into a loud A7 failure.
   *
   * Only on the CREATE path: a replay already found rows in this workspace, so
   * the workspace demonstrably exists, and a workspace suspended after
   * acceptance must still be able to return its own ids idempotently.
   *
   * A proper FK + ON DELETE behaviour is the durable fix and needs a migration;
   * this PR ships no schema change, so it is recorded as a follow-up in
   * docs/QUOTES-SEAM.md.
   */
  private async requireLiveWorkspace(tx: WorkspaceTxClient, workspaceId: string): Promise<void> {
    const ws = await tx.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, status: true },
    });
    if (!ws) {
      throw federationError(
        HttpStatus.NOT_FOUND,
        'FEDERATION_WORKSPACE_UNKNOWN',
        `The vouched workspace ${workspaceId} does not exist in Project-Ops; nothing was created.`,
      );
    }
    if (ws.status !== 'active') {
      throw federationError(
        HttpStatus.CONFLICT,
        'FEDERATION_WORKSPACE_INACTIVE',
        `The vouched workspace ${workspaceId} is ${ws.status}, not active; nothing was created.`,
      );
    }
  }

  /** The deterministic non-login service user the adapter attributes its writes to. Atomic upsert (unique username). */
  private async ensureFederationUser(tx: WorkspaceTxClient): Promise<{ id: string }> {
    return tx.user.upsert({
      where: { username: QUOTE_FEDERATION_USER.username },
      update: {},
      create: {
        ...QUOTE_FEDERATION_USER,
        role: UserRole.STAFF,
        isActive: true,
        password: null,
        weeklyCapacityHours: 0,
      },
      select: { id: true },
    });
  }

  private async creatorFor(
    tx: WorkspaceTxClient,
    actor: User,
    federationActor: string | null,
  ): Promise<string> {
    if (!federationActor) return actor.id;
    const svc = await this.ensureFederationUser(tx);
    return svc.id;
  }

  /** Link the Contact only when it resolves INSIDE the target workspace; otherwise leave it unlinked (logged). */
  private async resolveContactId(
    tx: WorkspaceTxClient,
    workspaceId: string,
    contactId: string | undefined,
  ): Promise<string | null> {
    const wanted = contactId?.trim();
    if (!wanted) return null;
    const contact = await tx.contact.findFirst({
      where: { id: wanted, workspaceId },
      select: { id: true },
    });
    if (!contact) {
      this.logger.warn(
        `quote.accepted: contact_id ${wanted} does not resolve in ws=${workspaceId}; project left unlinked`,
      );
      return null;
    }
    return contact.id;
  }

  // ── Create / merge (inside the locked tx) ─────────────────────────────────

  private async createFederation(
    tx: WorkspaceTxClient,
    workspaceId: string,
    actor: User,
    dto: QuoteAcceptedDto,
    currency: string,
    stored: StoredPdf | null,
    opts: { federationActor: string | null },
  ): Promise<TxOutcome> {
    const creatorId = await this.creatorFor(tx, actor, opts.federationActor);
    const projectNumber = await this.projectsService.nextProjectNumber(tx);
    const contactId = await this.resolveContactId(tx, workspaceId, dto.contact_id);
    const scheduleIds = mergeScheduleIds([], dto.schedule_ids);

    // Money: integer cents from Customer-Ops' single compute path, mirrored as
    // Decimal strings. billingAmount = budgetAmount = one-time + milestones;
    // defaultBillRate only from the resolved hourly.primary rate (A14).
    const committed = centsToAmountString(
      dto.billing.one_time_total_cents + dto.billing.milestone_total_cents,
    );
    const billRate =
      dto.billing.hourly_rate_cents !== undefined
        ? centsToAmountString(dto.billing.hourly_rate_cents)
        : null;

    const metadata = {
      quote: buildQuoteRef(dto, scheduleIds),
      quoteSummary: buildQuoteSummaryCache(dto, currency),
    } as unknown as Prisma.InputJsonObject;

    const project = await tx.project.create({
      data: {
        workspaceId,
        projectNumber,
        title: dto.title,
        description: `Created from accepted quote ${dto.number} v${dto.version} (Customer-Ops).`,
        clientName: dto.client_name,
        contactId,
        createdById: creatorId,
        billingAmount: committed,
        budgetAmount: committed,
        defaultBillRate: billRate,
        billingNotes: buildBillingNotes(dto.number, dto.version, dto.billing.schedule_text),
        metadata,
      },
    });

    // One task per accepted one_time / milestone line, in position order (A16).
    const tasks: Task[] = [];
    for (const line of selectTaskLines(dto.lines)) {
      const task = await tx.task.create({
        data: {
          workspaceId,
          projectId: project.id,
          title: line.label,
          description: line.acceptance_criteria_md ?? null,
          type: TaskType.TASK,
          status: TaskStatus.PENDING,
          priority: TaskPriority.MEDIUM,
          estimatedHours: line.estimated_hours ?? null,
          createdById: creatorId,
          metadata: buildTaskQuoteMetadata(dto, line) as unknown as Prisma.InputJsonObject,
        },
      });
      tasks.push(task);
    }

    const documentId = stored
      ? (await this.createDocument(tx, workspaceId, project.id, creatorId, dto, stored)).id
      : null;

    await this.auditService.log({
      workspaceId,
      userId: creatorId,
      projectId: project.id,
      action: 'CREATE',
      resource: 'Project',
      resourceId: project.id,
      details: {
        projectNumber,
        source: 'customer-ops',
        federationActor: opts.federationActor,
        quote: {
          customer_ops_quote_id: dto.customer_ops_quote_id,
          number: dto.number,
          version: dto.version,
        },
        tasks: tasks.length,
        documentId,
      },
    });

    return {
      created: true,
      creatorId,
      project,
      tasks,
      result: {
        status: 'done',
        created: true,
        project_id: project.id,
        project_number: project.projectNumber,
        task_ids: tasks.map((t) => t.id),
        document_id: documentId,
        contact_linked: contactId !== null,
        schedule_ids: scheduleIds,
        quote: {
          customer_ops_quote_id: dto.customer_ops_quote_id,
          number: dto.number,
          version: dto.version,
        },
      },
    };
  }

  /** Idempotent replay: same ids back; merge new schedule_ids; attach the PDF if it was missing. */
  private async mergeIntoExisting(
    tx: WorkspaceTxClient,
    workspaceId: string,
    actor: User,
    existing: ExistingFederation,
    dto: QuoteAcceptedDto,
    stored: StoredPdf | null,
    opts: { federationActor: string | null },
  ): Promise<TxOutcome> {
    const currentMeta =
      existing.project.metadata && typeof existing.project.metadata === 'object'
        ? (existing.project.metadata as Record<string, unknown>)
        : {};
    const currentQuote =
      currentMeta.quote && typeof currentMeta.quote === 'object'
        ? (currentMeta.quote as Record<string, unknown>)
        : {};
    const merged = mergeScheduleIds(currentQuote.schedule_ids, dto.schedule_ids);
    if (scheduleIdsChanged(currentQuote.schedule_ids, merged)) {
      await tx.project.update({
        where: { id: existing.project.id },
        data: {
          metadata: {
            ...currentMeta,
            quote: { ...currentQuote, schedule_ids: merged },
          } as unknown as Prisma.InputJsonObject,
        },
      });
    }

    let documentId = existing.document?.id ?? null;
    // Resolved lazily, and NEVER seeded from `actor.id`: for a federation actor
    // that is the synthetic string `federation:customer-ops`, not a `users` row
    // (L7). The replay path emits no events, so today it is unused — this keeps
    // it from becoming a 500 one refactor from now.
    let creatorId: string | null = null;
    if (!documentId && stored) {
      creatorId = await this.creatorFor(tx, actor, opts.federationActor);
      documentId = (
        await this.createDocument(tx, workspaceId, existing.project.id, creatorId, dto, stored)
      ).id;
    }

    return {
      created: false,
      creatorId,
      project: null,
      tasks: [],
      result: {
        status: 'done',
        created: false,
        project_id: existing.project.id,
        project_number: existing.project.projectNumber,
        task_ids: existing.tasks.map((t) => t.id),
        document_id: documentId,
        contact_linked: existing.project.contactId !== null,
        schedule_ids: merged,
        quote: {
          customer_ops_quote_id: dto.customer_ops_quote_id,
          number: dto.number,
          version: dto.version,
        },
      },
    };
  }

  private async createDocument(
    tx: WorkspaceTxClient,
    workspaceId: string,
    projectId: string,
    creatorId: string,
    dto: QuoteAcceptedDto,
    stored: StoredPdf,
  ): Promise<{ id: string }> {
    return tx.document.create({
      data: {
        workspaceId,
        projectId,
        uploadedById: creatorId,
        fileName: stored.fileName,
        fileSize: stored.size,
        mimeType: 'application/pdf',
        s3Key: stored.s3Key,
        s3Bucket: stored.bucket,
        status: DocumentStatus.UPLOADED,
        description: `Accepted quote ${dto.number} v${dto.version}`,
        tags: ['quote'],
        metadata: {
          quote: {
            customer_ops_quote_id: dto.customer_ops_quote_id,
            number: dto.number,
            version: dto.version,
          },
        } as unknown as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
  }

  // ── PDF (outside any tx) ──────────────────────────────────────────────────

  private async storePdf(
    workspaceId: string,
    dto: QuoteAcceptedDto,
    pdf: QuotePdfDto,
  ): Promise<StoredPdf> {
    const bytes = await this.resolvePdfBytes(pdf);
    if (!looksLikePdf(bytes)) {
      throw federationError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'PDF_INVALID',
        'The accepted PDF does not look like a PDF (missing %PDF- header); re-render and retry federation.',
      );
    }
    const fileName = safeFileName(pdf.file_name);
    const s3Key = quotePdfObjectKey(workspaceId, dto.customer_ops_quote_id, dto.version, fileName);
    try {
      await this.minio.uploadObject(s3Key, bytes, bytes.length, {
        'Content-Type': 'application/pdf',
      });
    } catch (err) {
      throw federationError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PDF_STORE_FAILED',
        `Could not store the accepted PDF: ${(err as Error).message}`,
      );
    }
    return { s3Key, bucket: this.minio.getBucketName(), fileName, size: bytes.length };
  }

  private async resolvePdfBytes(pdf: QuotePdfDto): Promise<Buffer> {
    if (pdf.base64) {
      const cleaned = pdf.base64.replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) {
        throw federationError(
          HttpStatus.BAD_REQUEST,
          'PDF_INVALID',
          'pdf.base64 is not valid base64.',
        );
      }
      const bytes = Buffer.from(cleaned, 'base64');
      if (bytes.length === 0) {
        throw federationError(
          HttpStatus.BAD_REQUEST,
          'PDF_INVALID',
          'pdf.base64 decodes to zero bytes.',
        );
      }
      if (bytes.length > QUOTE_PDF_MAX_BYTES) {
        throw federationError(
          HttpStatus.PAYLOAD_TOO_LARGE,
          'PDF_TOO_LARGE',
          `The accepted PDF exceeds ${QUOTE_PDF_MAX_BYTES} bytes.`,
        );
      }
      return bytes;
    }

    const url = this.requireAllowedPdfOrigin(pdf.url as string);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/pdf' },
        signal: controller.signal,
        // Never follow a redirect: a pinned origin that 302s inward would
        // otherwise hand us an internal endpoint (M2).
        redirect: 'manual',
      });
      if (res.status >= 300 && res.status < 400) {
        throw federationError(
          HttpStatus.BAD_GATEWAY,
          'PDF_FETCH_FAILED',
          `Fetching the accepted PDF returned HTTP ${res.status}; redirects are not followed. ` +
            'Send a direct URL on the allow-listed origin, or send pdf.base64.',
        );
      }
      if (!res.ok) {
        throw federationError(
          HttpStatus.BAD_GATEWAY,
          'PDF_FETCH_FAILED',
          `Fetching the accepted PDF returned HTTP ${res.status}.`,
        );
      }
      const declared = Number(res.headers.get('content-length') ?? '0');
      if (declared > QUOTE_PDF_MAX_BYTES) {
        throw federationError(
          HttpStatus.PAYLOAD_TOO_LARGE,
          'PDF_TOO_LARGE',
          `The accepted PDF exceeds ${QUOTE_PDF_MAX_BYTES} bytes.`,
        );
      }
      const bytes = await this.readCappedBody(res);
      if (bytes.length === 0) {
        throw federationError(
          HttpStatus.BAD_GATEWAY,
          'PDF_FETCH_FAILED',
          'The accepted PDF URL returned zero bytes.',
        );
      }
      return bytes;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw federationError(
        HttpStatus.BAD_GATEWAY,
        'PDF_FETCH_FAILED',
        `Could not fetch the accepted PDF: ${(err as Error).message}`,
      );
    } finally {
      // Covers the BODY read too, not only the headers: a peer that sends
      // headers and then stalls is aborted by the same timer.
      clearTimeout(timer);
    }
  }

  /**
   * Read the response body with the cap enforced **while streaming**, so a
   * lying or absent `content-length` cannot make us buffer an unbounded body
   * into memory first and check afterwards (M2). Falls back to `arrayBuffer()`
   * only when the runtime gives us no stream (test doubles).
   */
  private async readCappedBody(res: Response): Promise<Buffer> {
    const body = res.body as ReadableStream<Uint8Array> | null | undefined;
    if (!body || typeof body.getReader !== 'function') {
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > QUOTE_PDF_MAX_BYTES) {
        throw federationError(
          HttpStatus.PAYLOAD_TOO_LARGE,
          'PDF_TOO_LARGE',
          `The accepted PDF exceeds ${QUOTE_PDF_MAX_BYTES} bytes.`,
        );
      }
      return bytes;
    }

    const reader = body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > QUOTE_PDF_MAX_BYTES) {
          throw federationError(
            HttpStatus.PAYLOAD_TOO_LARGE,
            'PDF_TOO_LARGE',
            `The accepted PDF exceeds ${QUOTE_PDF_MAX_BYTES} bytes.`,
          );
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      // Stop the transfer on the cap/abort path instead of draining it.
      await reader.cancel().catch(() => undefined);
    }
    return Buffer.concat(chunks, total);
  }

  /**
   * SSRF fence for `pdf.url` (M2). The URL must sit on an allow-listed origin:
   * the configured Customer-Ops origin (`CUSTOMER_OPS_BASE_URL`) plus any extra
   * origins in `QUOTES_PDF_ALLOWED_ORIGINS` (CSV).
   *
   * **Fails closed**: with neither configured, a `pdf.url` is refused outright
   * rather than fetched — same posture as `PROJECT_OPS_FEDERATION_ACTORS`
   * defaulting to empty. `pdf.base64` is unaffected, so an operator who has not
   * configured an origin can still federate the PDF inline.
   */
  private requireAllowedPdfOrigin(raw: string): string {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw federationError(HttpStatus.BAD_REQUEST, 'PDF_URL_NOT_ALLOWED', 'pdf.url is not a URL.');
    }

    const allowed = this.allowedPdfOrigins();
    if (allowed.length === 0) {
      throw federationError(
        HttpStatus.BAD_REQUEST,
        'PDF_URL_NOT_ALLOWED',
        'pdf.url is refused because no PDF origin is allow-listed on this deployment. ' +
          'Set CUSTOMER_OPS_BASE_URL (or QUOTES_PDF_ALLOWED_ORIGINS), or send pdf.base64 instead.',
      );
    }
    if (!allowed.includes(parsed.origin)) {
      throw federationError(
        HttpStatus.BAD_REQUEST,
        'PDF_URL_NOT_ALLOWED',
        `pdf.url origin ${parsed.origin} is not allow-listed; the accepted PDF must come from the quote's own app.`,
      );
    }
    return parsed.toString();
  }

  private allowedPdfOrigins(): string[] {
    const origins: string[] = [];
    const push = (value: string | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed) return;
      try {
        const { origin } = new URL(trimmed);
        if (!origins.includes(origin)) origins.push(origin);
      } catch {
        this.logger.warn(`Ignoring unparseable PDF origin in configuration: ${trimmed}`);
      }
    };
    push(this.config.get<string>('CUSTOMER_OPS_BASE_URL'));
    for (const entry of (this.config.get<string>('QUOTES_PDF_ALLOWED_ORIGINS') ?? '').split(',')) {
      push(entry);
    }
    return origins;
  }
}
