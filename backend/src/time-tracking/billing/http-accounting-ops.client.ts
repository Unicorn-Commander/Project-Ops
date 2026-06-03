import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountingOpsPort,
  AoCallContext,
  AoCreateResult,
  AoInvoice,
  CreateInvoiceInput,
} from './accounting-ops.port';
import { billableRollupLive } from '../../common/workspace/feature-flags';

/**
 * Live Accounting-Ops AR client over AO's REST API:
 *   POST /api/workspaces/{ao_workspace_id}/invoices
 *   GET  /api/workspaces/{ao_workspace_id}/invoices/{invoice_id}
 *
 * Auth: forwards the acting user's bearer (Authorization header). AO resolves
 * workspace membership + role + the project-ops entitlement off that token.
 *
 * Config:
 *   ACCOUNTING_OPS_BASE_URL    e.g. https://accounting.magicunicorn.dev
 *   ACCOUNTING_OPS_WORKSPACE_ID  AO workspace UUID Project-Ops bills into
 *   ACCOUNTING_OPS_ENTITY_ID     AO billing entity UUID
 *   BILLABLE_ROLLUP_LIVE=true    arms the live call (else the rollup previews)
 *
 * Until these are set + AO entitlement is open (or Lago emits claims), the
 * rollup degrades gracefully to a draft + PDF preview.
 */
@Injectable()
export class HttpAccountingOpsClient extends AccountingOpsPort {
  private readonly logger = new Logger(HttpAccountingOpsClient.name);

  constructor(private readonly config: ConfigService) {
    super();
  }

  private get baseUrl(): string | undefined {
    return this.config.get<string>('ACCOUNTING_OPS_BASE_URL')?.replace(/\/$/, '');
  }
  private get aoWorkspaceId(): string | undefined {
    return this.config.get<string>('ACCOUNTING_OPS_WORKSPACE_ID');
  }
  private get aoEntityId(): string | undefined {
    return this.config.get<string>('ACCOUNTING_OPS_ENTITY_ID');
  }

  isLive(): boolean {
    return (
      billableRollupLive((k) => this.config.get<string>(k)) &&
      !!this.baseUrl &&
      !!this.aoWorkspaceId &&
      !!this.aoEntityId
    );
  }

  async createInvoiceFromDraft(
    input: CreateInvoiceInput,
    ctx: AoCallContext,
  ): Promise<AoCreateResult> {
    if (!this.isLive()) {
      return { ok: false, reason: 'DISABLED', message: 'Live Accounting-Ops invoicing is not enabled.' };
    }
    if (!ctx.bearerToken) {
      return {
        ok: false,
        reason: 'NOT_ENTITLED',
        message: 'No bearer token available to authenticate the Accounting-Ops call.',
      };
    }

    const url = `${this.baseUrl}/api/workspaces/${this.aoWorkspaceId}/invoices`;
    const body = {
      entity_id: this.aoEntityId,
      external_source: 'project-ops',
      external_ref: input.externalRef,
      customer: {
        name: input.customer.name,
        contact_id: input.customer.contactId ?? null,
        email: input.customer.email ?? null,
        billing_address: input.customer.billingAddress ?? null,
      },
      line_items: input.lineItems.map((li) => ({
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unitPrice,
        ...(li.amount !== undefined ? { amount: li.amount } : {}),
        source_ref: li.sourceRef ?? null,
      })),
      currency: input.currency,
      ...(input.issueDate ? { issue_date: input.issueDate } : {}),
      ...(input.dueDate ? { due_date: input.dueDate } : {}),
      ...(input.netTerms != null ? { net_terms: input.netTerms } : {}),
      ...(input.poNumber ? { po_number: input.poNumber } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      auto_send: input.autoSend ?? false,
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.bearerToken}`,
          // Path is authoritative; the header matches AO's resolver precedence.
          'X-Workspace-Id': this.aoWorkspaceId as string,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.logger.error(`Accounting-Ops unreachable at ${url}: ${(err as Error).message}`);
      return { ok: false, reason: 'UNREACHABLE', message: 'Accounting-Ops is unreachable right now.' };
    }

    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Accounting-Ops denied invoice (${res.status}): ${text.slice(0, 300)}`);
      return {
        ok: false,
        reason: 'NOT_ENTITLED',
        message:
          'Accounting-Ops declined the invoice (not entitled or insufficient role). ' +
          'Connect Accounting-Ops to invoice.',
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Accounting-Ops invoice failed ${res.status}: ${text.slice(0, 300)}`);
      return { ok: false, reason: 'ERROR', message: `Accounting-Ops error ${res.status}.` };
    }

    const data: any = await res.json().catch(() => ({}));
    return { ok: true, invoice: this.mapInvoice(data) };
  }

  async getInvoice(invoiceId: string, ctx: AoCallContext): Promise<AoInvoice | null> {
    if (!this.baseUrl || !this.aoWorkspaceId || !ctx.bearerToken) return null;
    const url = `${this.baseUrl}/api/workspaces/${this.aoWorkspaceId}/invoices/${invoiceId}`;
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${ctx.bearerToken}`,
          'X-Workspace-Id': this.aoWorkspaceId,
        },
      });
      if (!res.ok) return null;
      const data: any = await res.json().catch(() => null);
      return data ? this.mapInvoice(data) : null;
    } catch (err) {
      this.logger.warn(`get_invoice failed for ${invoiceId}: ${(err as Error).message}`);
      return null;
    }
  }

  private mapInvoice(data: any): AoInvoice {
    return {
      id: String(data.id ?? ''),
      invoiceNumber: data.invoice_number ?? null,
      status: data.status ?? null,
      total: data.total != null ? String(data.total) : null,
      balanceDue: data.balance_due != null ? String(data.balance_due) : null,
      externalRef: data.external_ref ?? null,
      pdfUrl: data.pdf_url ?? null,
      raw: data,
    };
  }
}
