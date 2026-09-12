import { QuoteSummary } from './quote-summary';

/**
 * Port to Customer-Ops, the quote's system of record (QUOTES-CONTRACT-v1 §0).
 * Project-Ops NEVER copies a quote; it reads the summary through this port at
 * render time. The default implementation (HttpCustomerOpsClient) speaks the
 * suite M2M rail with a service bearer, the same pattern as the Accounting-Ops
 * invoice-status poller (ACCOUNTING_OPS_SERVICE_TOKEN).
 */

export const CUSTOMER_OPS_PORT = 'CUSTOMER_OPS_PORT';

export interface QuoteSummaryRequest {
  /** Customer-Ops quote id (from project.metadata.quote.customer_ops_quote_id). */
  quoteId: string;
  /**
   * Project-Ops' OWN project id. Amendment 01 A15: Customer-Ops authorises the
   * read by workspace membership of the calling actor PLUS a
   * `federated.project_ops_project_id` match. A summary is never fetched by a
   * bare quote id.
   */
  projectOpsProjectId: string;
  /** The Project-Ops workspace the project lives in (sent as the X-Workspace-Id hint). */
  workspaceId: string;
}

export type CustomerOpsFailureReason =
  | 'UNCONFIGURED'
  | 'UNREACHABLE'
  | 'DENIED'
  | 'NOT_FOUND'
  | 'ERROR';

export type QuoteSummaryResult =
  | { ok: true; summary: QuoteSummary }
  | { ok: false; reason: CustomerOpsFailureReason; message: string };

export abstract class CustomerOpsPort {
  /** True when CUSTOMER_OPS_BASE_URL + CUSTOMER_OPS_SERVICE_TOKEN are set. */
  abstract isConfigured(): boolean;
  /** Never throws: every failure is a typed result so panels degrade clean. */
  abstract getQuoteSummary(req: QuoteSummaryRequest): Promise<QuoteSummaryResult>;
}
