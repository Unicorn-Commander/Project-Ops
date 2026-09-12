import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CUSTOMER_OPS_PORT,
  CustomerOpsFailureReason,
  CustomerOpsPort,
} from './customer-ops.port';
import {
  ClientQuoteSummary,
  QUOTE_TAX_NOTE,
  QuoteSummary,
  maskQuoteSummaryForClient,
  readCachedQuoteSummary,
  readProjectQuoteRef,
  summaryFromCache,
} from './quote-summary';

export type QuotePanelViewer = 'staff' | 'client';

/**
 * What the project page (staff) and the client portal (CLIENT) render.
 *
 *   linked=false          → the project did not come from a quote; hide the panel.
 *   source='customer-ops' → live read-through succeeded.
 *   source='cached'       → Customer-Ops is unconfigured / unreachable / denied;
 *                           `quote` is the small cached summary written at accept
 *                           time and `degraded` says why (staff wording names the
 *                           env vars; client wording never does).
 */
export interface QuotePanel {
  linked: boolean;
  source?: 'customer-ops' | 'cached';
  configured?: boolean;
  degraded?: { reason: CustomerOpsFailureReason; message: string } | null;
  /** Amendment 01 A9 — rendered next to the totals on every panel. */
  tax_note?: string;
  quote?: QuoteSummary | ClientQuoteSummary | null;
  /** Staff only: the Accounting-Ops schedule ids stored on the project (A14). */
  schedule_ids?: string[];
}

const CLIENT_DEGRADED_MESSAGE =
  'Live quote status is unavailable right now; showing the accepted summary.';

@Injectable()
export class QuotePanelService {
  private readonly logger = new Logger(QuotePanelService.name);

  constructor(@Inject(CUSTOMER_OPS_PORT) private readonly customerOps: CustomerOpsPort) {}

  /**
   * Build the Quote panel for a project. The DB read (project + metadata) is
   * the caller's, inside its own workspace RLS tx; the outbound HTTP read runs
   * OUTSIDE any tx (same discipline as MinIO I/O). Never throws for a
   * federation failure — the panel degrades to the cached summary.
   */
  async buildPanel(
    project: { id: string; metadata: unknown },
    viewer: QuotePanelViewer,
    ctx: { workspaceId: string },
  ): Promise<QuotePanel> {
    const ref = readProjectQuoteRef(project.metadata);
    if (!ref) return { linked: false };

    const cached = readCachedQuoteSummary(project.metadata);
    const configured = this.customerOps.isConfigured();

    let summary: QuoteSummary;
    let source: 'customer-ops' | 'cached';
    let degraded: QuotePanel['degraded'] = null;

    const result = await this.customerOps.getQuoteSummary({
      quoteId: ref.customer_ops_quote_id,
      projectOpsProjectId: project.id,
      workspaceId: ctx.workspaceId,
    });

    if (result.ok) {
      summary = result.summary;
      source = 'customer-ops';
    } else {
      summary = summaryFromCache(ref, cached);
      source = 'cached';
      degraded = {
        reason: result.reason,
        message: viewer === 'client' ? CLIENT_DEGRADED_MESSAGE : result.message,
      };
      if (result.reason !== 'UNCONFIGURED') {
        this.logger.warn(
          `Quote panel degraded to cache for project ${project.id} (${result.reason}): ${result.message}`,
        );
      }
    }

    if (viewer === 'client') {
      // Whitelist by construction: number, title, totals, status, share link.
      return {
        linked: true,
        source,
        degraded,
        tax_note: QUOTE_TAX_NOTE,
        quote: maskQuoteSummaryForClient(summary),
      };
    }

    return {
      linked: true,
      source,
      configured,
      degraded,
      tax_note: QUOTE_TAX_NOTE,
      quote: summary,
      schedule_ids: ref.schedule_ids,
    };
  }
}
