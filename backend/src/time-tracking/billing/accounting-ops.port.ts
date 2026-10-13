/**
 * Port to Accounting-Ops AR. Project-Ops ORIGINATES a billable draft; the
 * invoice itself is owned by Accounting-Ops. We never build invoices here.
 *
 * The default implementation (HttpAccountingOpsClient) calls AO's REST AR API
 * `POST /api/workspaces/{workspace_id}/invoices`, forwarding the acting user's
 * bearer. AO enforces workspace membership (>= accountant) and, for
 * external_source="project-ops", an entitlement check (both Project-Ops and
 * Accounting-Ops products on the token). On a not-entitled / unreachable /
 * disabled result the rollup falls back to a draft + PDF preview.
 */

export const ACCOUNTING_OPS_PORT = 'ACCOUNTING_OPS_PORT';

export interface AoCustomer {
  name: string;
  contactId?: string | null;
  email?: string | null;
  billingAddress?: string | null;
}

export interface AoLineItem {
  description: string;
  quantity: string; // decimal string
  unitPrice: string; // decimal string
  amount?: string; // pre-tax extended; AO derives if omitted
  sourceRef?: string | null; // TimeEntry id
}

export interface CreateInvoiceInput {
  externalRef: string; // idempotency key, deterministic per logical invoice
  currency: string;
  customer: AoCustomer;
  lineItems: AoLineItem[];
  netTerms?: number | null;
  dueDate?: string | null; // ISO date (YYYY-MM-DD)
  issueDate?: string | null;
  poNumber?: string | null;
  notes?: string | null;
  autoSend?: boolean;
  /** False keeps the Accounting-Ops row a draft (no journal). Issue posts it. */
  postJournal?: boolean;
  customerOpsCustomerId?: string | null;
  presentation?: Record<string, unknown> | null;
}

export interface AoInvoice {
  id: string;
  invoiceNumber?: string | null;
  status?: string | null;
  total?: string | null;
  balanceDue?: string | null;
  externalRef?: string | null;
  pdfUrl?: string | null;
  journalEntryId?: string | null;
  hostedPayUrl?: string | null;
  publicUrl?: string | null;
  raw?: any;
}

export type AoCreateResult =
  | { ok: true; invoice: AoInvoice }
  | { ok: false; reason: 'NOT_ENTITLED' | 'UNREACHABLE' | 'DISABLED' | 'ERROR'; message: string };

export interface AoCallContext {
  // The acting user's bearer token, forwarded verbatim to AO. When absent or
  // not accepted by AO (e.g. a non-federated web-session token), the call
  // degrades to the draft + preview path.
  bearerToken?: string | null;
  actingUser?: { id: string; email: string } | null;
}

export abstract class AccountingOpsPort {
  /** True when the live AO call is configured + flag-enabled. */
  abstract isLive(): boolean;
  abstract createInvoiceFromDraft(
    input: CreateInvoiceInput,
    ctx: AoCallContext,
  ): Promise<AoCreateResult>;
  /** Post a draft that already exists. Idempotent when the journal is already there. */
  abstract issueInvoice(invoiceId: string, ctx: AoCallContext): Promise<AoCreateResult>;
  abstract getInvoice(invoiceId: string, ctx: AoCallContext): Promise<AoInvoice | null>;
}
