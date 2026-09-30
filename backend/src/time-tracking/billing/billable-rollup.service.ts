import {
  Injectable,
  Inject,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, User, UserRole, PaymentStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService, WorkspaceTxClient } from '../../prisma/prisma.service';
import { WorkspaceContextService } from '../../common/workspace/workspace-context.service';
import { AuditService } from '../../audit/audit.service';
import { BillableDraftAssembler, BillableSource } from './billable-draft.assembler';
import { InvoicePdfService } from './invoice-pdf.service';
import {
  buildInvoicePresentation,
  FixedFeeLine,
  selectFixedFeesForScope,
} from './fixed-fee';
import {
  ACCOUNTING_OPS_PORT,
  AccountingOpsPort,
  AoCallContext,
  AoCreateResult,
  AoInvoice,
} from './accounting-ops.port';
import { CreateBillableDraftDto, BillableGroupBy } from '../dto/create-billable-draft.dto';
import { buildExternalRef } from './external-ref.util';

function mapPaymentStatus(aoStatus?: string | null): PaymentStatus {
  switch ((aoStatus || '').toLowerCase()) {
    case 'paid':
      return PaymentStatus.PAID;
    case 'partial':
      return PaymentStatus.PARTIALLY_PAID;
    case 'overdue':
      return PaymentStatus.OVERDUE;
    case 'void':
      return PaymentStatus.CANCELLED;
    default:
      return PaymentStatus.UNPAID;
  }
}

@Injectable()
export class BillableRollupService {
  private readonly logger = new Logger(BillableRollupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly assembler: BillableDraftAssembler,
    private readonly pdf: InvoicePdfService,
    @Inject(ACCOUNTING_OPS_PORT) private readonly ao: AccountingOpsPort,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async createBillableDraft(
    workspaceId: string,
    user: User,
    dto: CreateBillableDraftDto,
    ctx: AoCallContext,
  ) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only MANAGER or ADMIN can create a billable draft');
    }
    if (!dto.projectId && !dto.clientId) {
      throw new BadRequestException('Provide projectId or clientId');
    }

    // Read phase: time entries + uninvoiced flat fees + the customer, in ONE
    // short workspace tx. Close it before PDF / Accounting-Ops I/O. The
    // write-back opens a second tx, and only after a successful issue.
    const { entries, customer, fees, feeProjects } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const rows = await this.gatherEntries(tx, workspaceId, dto);
        const gathered = await this.gatherFixedFees(tx, workspaceId, dto);
        const cust = await this.resolveCustomer(tx, workspaceId, dto, rows, gathered.projects);
        return {
          entries: rows,
          customer: cust,
          fees: gathered.selection,
          feeProjects: gathered.projects,
        };
      },
      workspaceId,
    );

    const excluded = new Set(fees.excludedTaskIds);
    const hourlyEntries = entries.filter((e) => !e.taskId || !excluded.has(e.taskId));
    const priced = hourlyEntries.filter(
      (e) => e.billableAmount !== null && e.billRateApplied !== null,
    );
    const unpricedCount = hourlyEntries.length - priced.length;

    const timeSources: BillableSource[] = priced.map((e) => ({
      id: e.id,
      date: e.startedAt,
      description: e.description || e.task?.title || 'Work',
      quantityHours: new Decimal(e.roundingAppliedSeconds ?? e.durationSeconds ?? 0).div(3600),
      unitRate: new Decimal(e.billRateApplied as Prisma.Decimal),
      amount: new Decimal(e.billableAmount as Prisma.Decimal),
      currency: e.currency,
      taskId: e.taskId,
      taskTitle: e.task?.title ?? null,
      role: e.user?.role ?? null,
      userId: e.userId,
    }));
    const fixedSources: BillableSource[] = fees.lines.map((line) => ({
      id: line.sourceId,
      date: new Date(),
      description: line.title,
      quantityHours: new Decimal(1),
      unitRate: line.amount,
      amount: line.amount,
      currency: 'USD',
      taskId: line.taskId,
      taskTitle: line.title,
    }));

    if (timeSources.length === 0 && fixedSources.length === 0) {
      if (entries.length > 0 && hourlyEntries.length === 0) {
        throw new BadRequestException(
          'The matching time sits on flat-fee tasks, and no uninvoiced flat fee remains',
        );
      }
      if (hourlyEntries.length > 0) {
        throw new BadRequestException(
          'Matching entries have no resolved bill rate; set a BillingRate or project default rate first',
        );
      }
      throw new BadRequestException(
        'No approved, billable, unbilled time and no uninvoiced flat fee match this scope',
      );
    }

    const sources = [...timeSources, ...fixedSources];
    const draft = this.assembler.assemble(sources, dto.groupBy ?? BillableGroupBy.TASK);
    const externalRef = buildExternalRef(
      workspaceId,
      { projectId: dto.projectId, clientId: dto.clientId },
      draft.sourceIds,
    );
    const projectIds = Array.from(
      new Set<string>([...priced.map((e) => e.projectId), ...fees.lines.map((l) => l.projectId)]),
    );
    const singleProject =
      projectIds.length === 1
        ? (priced[0]?.project ?? feeProjects.find((p) => p.id === projectIds[0]) ?? null)
        : null;

    const periodLabel =
      dto.periodStart || dto.periodEnd
        ? `${dto.periodStart?.slice(0, 10) ?? '…'} → ${dto.periodEnd?.slice(0, 10) ?? '…'}`
        : 'All approved, unbilled';

    // Always produce a preview so there's an artifact regardless of the AO call.
    const { previewUrl } = await this.pdf.renderAndStore(workspaceId, draft, {
      fromName: this.config.get<string>('INVOICE_FROM_NAME', 'Project Ops'),
      customerName: customer.name,
      customerEmail: customer.email,
      projectLabel: singleProject
        ? `${singleProject.projectNumber} — ${singleProject.title}`
        : `${projectIds.length} projects`,
      periodLabel,
      externalRef,
    });

    const fixedOnly = timeSources.length === 0 && fixedSources.length > 0;
    const netTerms = fixedOnly
      ? 0
      : Number(this.config.get<string>('INVOICE_NET_TERMS', '30')) || 30;
    const presentation = buildInvoicePresentation(fees.lines, timeSources.length);
    const suiteCustomerId = this.oneSuiteId(feeProjects.map((p) => p.customerOpsCustomerId));
    const suiteContactId = this.oneSuiteId(feeProjects.map((p) => p.contactOpsContactId));
    const aoCustomer = {
      ...customer,
      ...(suiteContactId ? { contactId: suiteContactId } : {}),
    };
    const feeNote =
      fees.lines.length === 0
        ? ''
        : `${fees.lines.length} flat fee${fees.lines.length === 1 ? '' : 's'}`;
    const timeNote =
      priced.length === 0
        ? ''
        : `${priced.length} time entr${priced.length === 1 ? 'y' : 'ies'}`;
    const notes = `Generated from Project-Ops — ${[feeNote, timeNote].filter(Boolean).join(' and ')}.`;

    let aoResult: AoCreateResult | null = null;
    if (this.ao.isLive()) {
      aoResult = await this.ao.createInvoiceFromDraft(
        {
          externalRef,
          currency: draft.currency,
          customer: aoCustomer,
          lineItems: draft.lineItems.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: li.amount,
            sourceRef: this.lineSourceRef(li.sourceRefs),
          })),
          netTerms,
          poNumber: singleProject?.projectNumber ?? null,
          notes,
          autoSend: false,
          postJournal: false,
          customerOpsCustomerId: suiteCustomerId,
          presentation,
        },
        ctx,
      );
    }

    const wantIssue = dto.issue === true || dto.autoSend === true;
    const preview = {
      previewUrl,
      draft: this.draftView(draft),
      unpricedCount,
      externalRef,
    };

    if (wantIssue && aoResult?.ok) {
      let invoice = aoResult.invoice;
      if (!this.alreadyPosted(invoice)) {
        const issued = await this.ao.issueInvoice(invoice.id, ctx);
        if (!issued.ok) {
          await this.auditDraft(user, workspaceId, singleProject?.id, 'DRAFT', issued.reason, externalRef);
          return {
            status: 'DRAFT',
            invoice,
            reason: issued.reason,
            message: issued.message,
            ...preview,
          };
        }
        invoice = issued.invoice;
      }
      await this.markBilledAndMirror(
        user,
        workspaceId,
        priced.map((e) => e.id),
        fees.lines,
        projectIds,
        singleProject ? singleProject.id : null,
        { ok: true, invoice },
        draft.total,
      );
      await this.audit.log({
        workspaceId,
        userId: user.id,
        projectId: singleProject?.id,
        action: 'EXPORT',
        resource: 'TimeEntry',
        details: {
          action: 'issue_invoice',
          result: 'INVOICED',
          invoiceId: invoice.id,
          externalRef,
          entryCount: draft.sourceIds.length,
        },
      });
      this.events.emit('billing.invoiced', { workspaceId, projectIds, invoice });
      this.logger.log(
        `issue_invoice: user=${user.email} INVOICED invoice=${invoice.id} sources=${draft.sourceIds.length}`,
      );
      return { status: 'INVOICED', invoice, ...preview };
    }

    if (!wantIssue && aoResult?.ok) {
      await this.auditDraft(user, workspaceId, singleProject?.id, 'DRAFT', 'preview', externalRef);
      this.logger.log(`create_billable_draft: user=${user.email} DRAFT invoice=${aoResult.invoice.id}`);
      return { status: 'DRAFT', invoice: aoResult.invoice, ...preview };
    }

    const reason = aoResult && !aoResult.ok ? aoResult.reason : 'DISABLED';
    const message =
      aoResult && !aoResult.ok
        ? aoResult.message
        : 'Live Accounting-Ops invoicing is off. Connect Accounting-Ops to invoice.';
    await this.auditDraft(user, workspaceId, singleProject?.id, 'DRAFT_ONLY', reason, externalRef);
    this.logger.log(`create_billable_draft: user=${user.email} DRAFT_ONLY reason=${reason}`);
    return {
      status: 'DRAFT_ONLY',
      reason,
      message,
      connectAccountingOps: true,
      ...preview,
    };
  }

  /**
   * Pull invoice status from AO for billed entries and mirror onto the Project
   * billing fields. AO has no webhooks, so this is poll-driven. Requires a
   * bearer (service token in the poller, or the user's token on demand).
   *
   * SUITE TENANCY (§6): the DB reads/writes are workspace-scoped and MUST run on
   * a workspace RLS tx — under live RLS a cross-workspace scan is illegal. Pass
   * `scope`:
   *   - `{ workspaceId, user }` (on-demand REST/MCP) → wrapped in runForUser,
   *   - `{ workspaceId }` (poller, no request user) → wrapped in withWorkspace.
   * When `scope` is omitted there is no workspace to fence the query to, so it is
   * a safe no-op (returns synced:0). Network I/O (AO getInvoice) is done between
   * short reads/writes, never holding a tx open across the HTTP call.
   *
   * NOTE: `bearerToken` stays the FIRST positional arg; both the REST route and
   * the MCP `sync_invoice_status` tool now pass `{ workspaceId, user }` as scope.
   */
  async syncInvoiceStatuses(
    bearerToken: string | null | undefined,
    scope?: { workspaceId: string; user?: User },
    limit = 100,
  ): Promise<{ synced: number }> {
    if (!bearerToken) return { synced: 0 };
    if (!scope?.workspaceId) {
      // No workspace context → can't fence the query under RLS; do nothing.
      this.logger.debug('syncInvoiceStatuses skipped: no workspace scope provided');
      return { synced: 0 };
    }

    // Read the distinct billed invoice refs for THIS workspace in one short tx.
    const refs = await this.runScopedSync(scope, (tx) =>
      tx.timeEntry.findMany({
        where: { workspaceId: scope.workspaceId, billed: true, invoiceRef: { not: null } },
        distinct: ['invoiceRef'],
        select: { invoiceRef: true },
        take: limit,
      }),
    );

    let synced = 0;
    for (const r of refs) {
      const invoiceId = r.invoiceRef as string;
      // Network call OUTSIDE any tx.
      const inv = await this.ao.getInvoice(invoiceId, { bearerToken });
      if (!inv) continue;

      const total = inv.total != null ? Number(inv.total) : null;
      const balance = inv.balanceDue != null ? Number(inv.balanceDue) : null;
      const amountPaid =
        total != null && balance != null ? Math.max(0, total - balance) : undefined;
      const paymentStatus = mapPaymentStatus(inv.status);

      // Read affected projects + mirror onto them in one short workspace tx.
      const projects = await this.runScopedSync(scope, async (tx) => {
        const ps = await tx.timeEntry.findMany({
          where: { workspaceId: scope.workspaceId, invoiceRef: invoiceId },
          distinct: ['projectId'],
          select: { projectId: true },
        });
        for (const p of ps) {
          await tx.project.update({
            where: { id: p.projectId },
            data: {
              paymentStatus,
              ...(amountPaid !== undefined ? { amountPaid: amountPaid as any } : {}),
              ...(paymentStatus === PaymentStatus.PAID ? { paymentReceivedDate: new Date() } : {}),
            },
          });
        }
        return ps;
      });

      for (const p of projects) {
        this.events.emit('project.status-changed', { projectId: p.projectId, paymentStatus });
      }
      synced += 1;
    }
    if (synced)
      this.logger.log(
        `syncInvoiceStatuses: updated ${synced} invoice mirror(s) ws=${scope.workspaceId}`,
      );
    return { synced };
  }

  /**
   * Run `fn` inside the right workspace RLS tx for a sync call: runForUser when a
   * request user is present (re-authorizes membership), else withWorkspace for
   * the system poller. Kept private so the sync loop can open several short txns
   * around the AO network I/O instead of one long-held transaction.
   */
  private runScopedSync<T>(
    scope: { workspaceId: string; user?: User },
    fn: (tx: WorkspaceTxClient) => Promise<T>,
  ): Promise<T> {
    if (scope.user) {
      return this.workspaceContext.runForUser(scope.user, fn, scope.workspaceId);
    }
    return this.prisma.withWorkspace(scope.workspaceId, '', fn);
  }

  // ── internals ────────────────────────────────────────────

  private async gatherEntries(
    tx: WorkspaceTxClient,
    workspaceId: string,
    dto: CreateBillableDraftDto,
  ) {
    const where: Prisma.TimeEntryWhereInput = {
      workspaceId,
      approvalStatus: 'APPROVED',
      billable: true,
      billed: false,
      endedAt: { not: null },
    };
    if (dto.projectId) {
      where.projectId = dto.projectId;
    } else if (dto.clientId) {
      where.project = { contactId: dto.clientId };
    }
    if (dto.periodStart || dto.periodEnd) {
      const range: Prisma.DateTimeFilter = {};
      if (dto.periodStart) range.gte = new Date(dto.periodStart);
      if (dto.periodEnd) range.lte = new Date(dto.periodEnd);
      where.startedAt = range;
    }

    return tx.timeEntry.findMany({
      where,
      orderBy: { startedAt: 'asc' },
      include: {
        user: { select: { role: true, firstName: true, lastName: true, email: true } },
        task: { select: { id: true, title: true } },
        project: {
          select: {
            id: true,
            projectNumber: true,
            title: true,
            clientName: true,
            clientEmail: true,
            contactId: true,
            contact: {
              select: { id: true, firstName: true, lastName: true, email: true, company: true },
            },
          },
        },
      },
    });
  }

  private async gatherFixedFees(
    tx: WorkspaceTxClient,
    workspaceId: string,
    dto: CreateBillableDraftDto,
  ) {
    const where: Prisma.ProjectWhereInput = { workspaceId };
    if (dto.projectId) where.id = dto.projectId;
    else if (dto.clientId) where.contactId = dto.clientId;
    const projects = await tx.project.findMany({
      where,
      select: {
        id: true,
        title: true,
        projectNumber: true,
        flatFeeAmount: true,
        flatFeeInvoicedAt: true,
        customerOpsCustomerId: true,
        contactOpsContactId: true,
        clientName: true,
        clientEmail: true,
        contactId: true,
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true, company: true },
        },
      },
    });
    const tasks = projects.length
      ? await tx.task.findMany({
          where: { workspaceId, projectId: { in: projects.map((p) => p.id) } },
          select: {
            id: true,
            projectId: true,
            title: true,
            description: true,
            fixedAmount: true,
            invoicedAt: true,
          },
        })
      : [];
    return { projects, selection: selectFixedFeesForScope(projects, tasks) };
  }

  private oneSuiteId(ids: Array<string | null | undefined>): string | null {
    const present = Array.from(new Set(ids.filter((id): id is string => !!id)));
    return present.length === 1 ? present[0] : null;
  }

  private alreadyPosted(invoice: AoInvoice): boolean {
    if (invoice.journalEntryId) return true;
    const status = (invoice.status || '').toLowerCase();
    return status !== '' && status !== 'draft';
  }

  private async auditDraft(
    user: User,
    workspaceId: string,
    projectId: string | undefined,
    result: string,
    reason: string,
    externalRef: string,
  ) {
    await this.audit.log({
      workspaceId,
      userId: user.id,
      projectId,
      action: 'EXPORT',
      resource: 'TimeEntry',
      details: { action: 'create_billable_draft', result, reason, externalRef },
    });
  }

  private async resolveCustomer(
    tx: WorkspaceTxClient,
    workspaceId: string,
    dto: CreateBillableDraftDto,
    priced: any[],
    feeProjects: Array<{
      clientName: string | null;
      clientEmail: string | null;
      contactId: string | null;
      contact: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        company: string | null;
      } | null;
    }> = [],
  ): Promise<{ name: string; email?: string | null; contactId?: string | null }> {
    if (dto.clientId) {
      const contact = await tx.contact.findUnique({ where: { id: dto.clientId } });
      if (contact) {
        const name =
          `${contact.firstName} ${contact.lastName}`.trim() || contact.company || 'Client';
        return { name, email: contact.email, contactId: contact.id };
      }
    }
    const project = priced[0]?.project ?? feeProjects[0];
    if (!project) return { name: 'Client' };
    if (project?.contact) {
      const c = project.contact;
      const name = `${c.firstName} ${c.lastName}`.trim() || c.company || project.clientName;
      return { name, email: c.email ?? project.clientEmail, contactId: c.id };
    }
    return {
      name: project?.clientName ?? 'Client',
      email: project?.clientEmail,
      contactId: project?.contactId,
    };
  }

  private lineSourceRef(refs: string[]): string {
    if (refs.length === 1) return refs[0];
    const joined = refs.join(',');
    return joined.length <= 256 ? joined : `${refs[0]}+${refs.length - 1}`;
  }

  private async markBilledAndMirror(
    user: User,
    workspaceId: string,
    timeEntryIds: string[],
    feeLines: FixedFeeLine[],
    projectIds: string[],
    singleProjectId: string | null,
    aoResult: Extract<AoCreateResult, { ok: true }>,
    total: string,
  ) {
    const now = new Date();
    const invoice = aoResult.invoice;
    const paymentStatus = mapPaymentStatus(invoice.status);
    const fixedTaskIds = feeLines
      .filter((line) => line.kind === 'fixed_task' && line.taskId)
      .map((line) => line.taskId as string);
    const flatFeeProjectIds = feeLines
      .filter((line) => line.kind === 'fixed_project')
      .map((line) => line.projectId);

    // A $transaction(ARRAY) batch CANNOT carry SET LOCAL, so it would bypass the
    // RLS GUC under the NOBYPASSRLS runtime role. Rewritten as an interactive
    // runForUser callback: same atomicity (single tx, all-or-nothing) AND the
    // GUC is pinned for the duration.
    await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        if (timeEntryIds.length) {
          await tx.timeEntry.updateMany({
            where: { id: { in: timeEntryIds }, workspaceId, billed: false },
            data: { billed: true, invoiceRef: invoice.id, lockedAt: now },
          });
        }
        if (fixedTaskIds.length) {
          await tx.task.updateMany({
            where: { id: { in: fixedTaskIds }, workspaceId, invoicedAt: null },
            data: { invoicedAt: now, invoiceExternalRef: invoice.id },
          });
        }
        if (flatFeeProjectIds.length) {
          await tx.project.updateMany({
            where: { id: { in: flatFeeProjectIds }, workspaceId, flatFeeInvoicedAt: null },
            data: { flatFeeInvoicedAt: now },
          });
        }

        if (singleProjectId) {
          await tx.project.update({
            where: { id: singleProjectId },
            data: {
              invoiceNumber: invoice.invoiceNumber ?? invoice.id,
              billingAmount: (invoice.total ? Number(invoice.total) : Number(total)) as any,
              paymentStatus,
              billingDate: now,
            },
          });
        } else {
          // Multi-project client invoice: stamp the invoice ref on each project,
          // but don't overwrite per-project billingAmount.
          await tx.project.updateMany({
            where: { id: { in: projectIds } },
            data: { invoiceNumber: invoice.invoiceNumber ?? invoice.id, billingDate: now },
          });
        }
      },
      workspaceId,
    );
  }

  private draftView(draft: {
    lineItems: any[];
    total: string;
    currency: string;
    entryCount: number;
  }) {
    return {
      currency: draft.currency,
      total: draft.total,
      entryCount: draft.entryCount,
      lineItems: draft.lineItems,
    };
  }
}
