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
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { decToNum } from '../serialize';
import { BillableDraftAssembler, BillableSource } from './billable-draft.assembler';
import { InvoicePdfService } from './invoice-pdf.service';
import {
  ACCOUNTING_OPS_PORT,
  AccountingOpsPort,
  AoCallContext,
  AoCreateResult,
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

    const entries = await this.gatherEntries(workspaceId, dto);
    if (entries.length === 0) {
      throw new BadRequestException(
        'No approved, billable, unbilled time entries match this scope/period',
      );
    }

    // Only entries with a resolved price can be invoiced; the rest are reported
    // back so they can be re-rated, and are deliberately left unbilled.
    const priced = entries.filter((e) => e.billableAmount !== null && e.billRateApplied !== null);
    const unpricedCount = entries.length - priced.length;
    if (priced.length === 0) {
      throw new BadRequestException(
        'Matching entries have no resolved bill rate; set a BillingRate or project default rate first',
      );
    }

    const sources: BillableSource[] = priced.map((e) => ({
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

    const draft = this.assembler.assemble(sources, dto.groupBy ?? BillableGroupBy.TASK);
    const customer = await this.resolveCustomer(workspaceId, dto, priced);
    const externalRef = buildExternalRef(
      workspaceId,
      { projectId: dto.projectId, clientId: dto.clientId },
      draft.sourceIds,
    );
    const projectIds = Array.from(new Set(priced.map((e) => e.projectId)));
    const singleProject = projectIds.length === 1 ? priced[0].project : null;

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

    let aoResult: AoCreateResult | null = null;
    if (this.ao.isLive()) {
      aoResult = await this.ao.createInvoiceFromDraft(
        {
          externalRef,
          currency: draft.currency,
          customer,
          lineItems: draft.lineItems.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            amount: li.amount,
            sourceRef: this.lineSourceRef(li.sourceRefs),
          })),
          netTerms: Number(this.config.get<string>('INVOICE_NET_TERMS', '30')) || 30,
          poNumber: singleProject?.projectNumber ?? null,
          notes: `Generated from Project-Ops — ${priced.length} time entr${priced.length === 1 ? 'y' : 'ies'}.`,
          autoSend: dto.autoSend ?? false,
        },
        ctx,
      );
    }

    if (aoResult && aoResult.ok) {
      await this.markBilledAndMirror(
        workspaceId,
        draft.sourceIds,
        projectIds,
        singleProject ? singleProject.id : null,
        aoResult,
        draft.total,
      );
      await this.audit.log({
        userId: user.id,
        projectId: singleProject?.id,
        action: 'EXPORT',
        resource: 'TimeEntry',
        details: {
          action: 'create_billable_draft',
          result: 'INVOICED',
          invoiceId: aoResult.invoice.id,
          externalRef,
          entryCount: draft.sourceIds.length,
        },
      });
      this.events.emit('billing.invoiced', {
        workspaceId,
        projectIds,
        invoice: aoResult.invoice,
      });
      this.logger.log(
        `create_billable_draft: user=${user.email} INVOICED invoice=${aoResult.invoice.id} entries=${draft.sourceIds.length}`,
      );

      return {
        status: 'INVOICED',
        invoice: aoResult.invoice,
        previewUrl,
        draft: this.draftView(draft),
        unpricedCount,
      };
    }

    // Fallback: draft + preview only.
    const reason = aoResult && !aoResult.ok ? aoResult.reason : 'DISABLED';
    const message =
      aoResult && !aoResult.ok
        ? aoResult.message
        : 'Live Accounting-Ops invoicing is off. Connect Accounting-Ops to invoice.';

    await this.audit.log({
      userId: user.id,
      projectId: singleProject?.id,
      action: 'EXPORT',
      resource: 'TimeEntry',
      details: { action: 'create_billable_draft', result: 'DRAFT_ONLY', reason, externalRef },
    });
    this.logger.log(`create_billable_draft: user=${user.email} DRAFT_ONLY reason=${reason}`);

    return {
      status: 'DRAFT_ONLY',
      reason,
      message,
      connectAccountingOps: true,
      externalRef,
      previewUrl,
      draft: this.draftView(draft),
      unpricedCount,
    };
  }

  /**
   * Pull invoice status from AO for billed entries and mirror onto the Project
   * billing fields. AO has no webhooks, so this is poll-driven. Requires a
   * bearer (service token in the poller, or the user's token on demand).
   */
  async syncInvoiceStatuses(bearerToken: string | null | undefined, limit = 100): Promise<{ synced: number }> {
    if (!bearerToken) return { synced: 0 };

    const refs = await this.prisma.timeEntry.findMany({
      where: { billed: true, invoiceRef: { not: null } },
      distinct: ['invoiceRef'],
      select: { invoiceRef: true },
      take: limit,
    });

    let synced = 0;
    for (const r of refs) {
      const invoiceId = r.invoiceRef as string;
      const inv = await this.ao.getInvoice(invoiceId, { bearerToken });
      if (!inv) continue;

      const projects = await this.prisma.timeEntry.findMany({
        where: { invoiceRef: invoiceId },
        distinct: ['projectId'],
        select: { projectId: true },
      });
      const total = inv.total != null ? Number(inv.total) : null;
      const balance = inv.balanceDue != null ? Number(inv.balanceDue) : null;
      const amountPaid = total != null && balance != null ? Math.max(0, total - balance) : undefined;
      const paymentStatus = mapPaymentStatus(inv.status);

      for (const p of projects) {
        await this.prisma.project.update({
          where: { id: p.projectId },
          data: {
            paymentStatus,
            ...(amountPaid !== undefined ? { amountPaid: amountPaid as any } : {}),
            ...(paymentStatus === PaymentStatus.PAID ? { paymentReceivedDate: new Date() } : {}),
          },
        });
        this.events.emit('project.status-changed', { projectId: p.projectId, paymentStatus });
      }
      synced += 1;
    }
    if (synced) this.logger.log(`syncInvoiceStatuses: updated ${synced} invoice mirror(s)`);
    return { synced };
  }

  // ── internals ────────────────────────────────────────────

  private async gatherEntries(workspaceId: string, dto: CreateBillableDraftDto) {
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

    return this.prisma.timeEntry.findMany({
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
            contact: { select: { id: true, firstName: true, lastName: true, email: true, company: true } },
          },
        },
      },
    });
  }

  private async resolveCustomer(
    workspaceId: string,
    dto: CreateBillableDraftDto,
    priced: any[],
  ): Promise<{ name: string; email?: string | null; contactId?: string | null }> {
    if (dto.clientId) {
      const contact = await this.prisma.contact.findUnique({ where: { id: dto.clientId } });
      if (contact) {
        const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.company || 'Client';
        return { name, email: contact.email, contactId: contact.id };
      }
    }
    const project = priced[0].project;
    if (project?.contact) {
      const c = project.contact;
      const name = `${c.firstName} ${c.lastName}`.trim() || c.company || project.clientName;
      return { name, email: c.email ?? project.clientEmail, contactId: c.id };
    }
    return { name: project?.clientName ?? 'Client', email: project?.clientEmail, contactId: project?.contactId };
  }

  private lineSourceRef(refs: string[]): string {
    if (refs.length === 1) return refs[0];
    const joined = refs.join(',');
    return joined.length <= 256 ? joined : `${refs[0]}+${refs.length - 1}`;
  }

  private async markBilledAndMirror(
    workspaceId: string,
    sourceIds: string[],
    projectIds: string[],
    singleProjectId: string | null,
    aoResult: Extract<AoCreateResult, { ok: true }>,
    total: string,
  ) {
    const now = new Date();
    const invoice = aoResult.invoice;
    const paymentStatus = mapPaymentStatus(invoice.status);

    const ops: Prisma.PrismaPromise<any>[] = [
      this.prisma.timeEntry.updateMany({
        where: { id: { in: sourceIds }, workspaceId, billed: false },
        data: { billed: true, invoiceRef: invoice.id, lockedAt: now },
      }),
    ];

    if (singleProjectId) {
      ops.push(
        this.prisma.project.update({
          where: { id: singleProjectId },
          data: {
            invoiceNumber: invoice.invoiceNumber ?? invoice.id,
            billingAmount: (invoice.total ? Number(invoice.total) : Number(total)) as any,
            paymentStatus,
            billingDate: now,
          },
        }),
      );
    } else {
      // Multi-project client invoice: stamp the invoice ref on each project,
      // but don't overwrite per-project billingAmount.
      ops.push(
        this.prisma.project.updateMany({
          where: { id: { in: projectIds } },
          data: { invoiceNumber: invoice.invoiceNumber ?? invoice.id, billingDate: now },
        }),
      );
    }

    await this.prisma.$transaction(ops);
  }

  private draftView(draft: { lineItems: any[]; total: string; currency: string; entryCount: number }) {
    return {
      currency: draft.currency,
      total: draft.total,
      entryCount: draft.entryCount,
      lineItems: draft.lineItems,
    };
  }
}
