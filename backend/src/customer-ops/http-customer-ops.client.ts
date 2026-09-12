import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CustomerOpsPort,
  QuoteSummaryRequest,
  QuoteSummaryResult,
} from './customer-ops.port';
import { normalizeQuoteSummary } from './quote-summary';

/** Default per-request timeout (ms). Override via CUSTOMER_OPS_TIMEOUT_MS. */
export const CUSTOMER_OPS_DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Live Customer-Ops read-through over its REST API:
 *   GET {CUSTOMER_OPS_BASE_URL}/api/quotes/{quote_id}/summary?project_ops_project_id={project_id}
 *
 * Auth: the suite service-token pattern (a long-lived service bearer minted
 * for Project-Ops, exactly like ACCOUNTING_OPS_SERVICE_TOKEN for the invoice
 * poller). Customer-Ops resolves the actor's workspace membership off that
 * bearer and additionally requires the quote's `federated.project_ops_project_id`
 * to equal the project id we send (Amendment 01 A15). The `X-Workspace-Id`
 * header is a HINT for its resolver precedence, never the tenancy boundary.
 *
 * Config:
 *   CUSTOMER_OPS_BASE_URL       e.g. https://customers.magicunicorn.dev
 *   CUSTOMER_OPS_SERVICE_TOKEN  service bearer (name only — value lives in the env / Vaultwarden)
 *   CUSTOMER_OPS_TIMEOUT_MS     optional, default 5000
 *
 * Unconfigured ⇒ `isConfigured() === false` and every call returns
 * `{ ok: false, reason: 'UNCONFIGURED' }` WITHOUT touching the network, so the
 * Quote panel renders its cached summary with a "connect Customer-Ops" note.
 * This client never throws and never logs the token.
 */
@Injectable()
export class HttpCustomerOpsClient extends CustomerOpsPort {
  private readonly logger = new Logger(HttpCustomerOpsClient.name);

  /**
   * The transport. A class property (NOT a constructor parameter) so Nest DI
   * never tries to resolve it; tests override it with a stub. Wrapped so the
   * global fetch keeps its own `this`.
   */
  protected fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  constructor(private readonly config: ConfigService) {
    super();
  }

  /** Test seam: swap the transport (never used at runtime). */
  useFetch(impl: typeof fetch): this {
    this.fetchImpl = impl;
    return this;
  }

  private get baseUrl(): string | undefined {
    const raw = this.config.get<string>('CUSTOMER_OPS_BASE_URL');
    const trimmed = raw?.trim().replace(/\/+$/, '');
    return trimmed ? trimmed : undefined;
  }

  private get serviceToken(): string | undefined {
    const raw = this.config.get<string>('CUSTOMER_OPS_SERVICE_TOKEN');
    return raw?.trim() ? raw.trim() : undefined;
  }

  private get timeoutMs(): number {
    const raw = this.config.get<string>('CUSTOMER_OPS_TIMEOUT_MS');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : CUSTOMER_OPS_DEFAULT_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    return !!this.baseUrl && !!this.serviceToken;
  }

  async getQuoteSummary(req: QuoteSummaryRequest): Promise<QuoteSummaryResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        reason: 'UNCONFIGURED',
        message:
          'Connect Customer-Ops: set CUSTOMER_OPS_BASE_URL and CUSTOMER_OPS_SERVICE_TOKEN to read live quote status.',
      };
    }
    if (!req.quoteId?.trim() || !req.projectOpsProjectId?.trim()) {
      // A15: never fetch by a bare quote id.
      return {
        ok: false,
        reason: 'ERROR',
        message: 'A quote summary is read only with its Project-Ops project id (never a bare quote id).',
      };
    }

    const url =
      `${this.baseUrl}/api/quotes/${encodeURIComponent(req.quoteId)}/summary` +
      `?project_ops_project_id=${encodeURIComponent(req.projectOpsProjectId)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.serviceToken}`,
          // Hints for Customer-Ops' resolver; the bearer + project-id match are the gates.
          'X-Workspace-Id': req.workspaceId,
          'X-Project-Ops-Project-Id': req.projectOpsProjectId,
        },
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.warn(`Customer-Ops unreachable for quote ${req.quoteId}: ${(err as Error).message}`);
      return { ok: false, reason: 'UNREACHABLE', message: 'Customer-Ops is unreachable right now.' };
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Customer-Ops denied quote summary ${req.quoteId} (${res.status}): ${text.slice(0, 200)}`);
      return {
        ok: false,
        reason: 'DENIED',
        message: 'Customer-Ops declined the read (service token not entitled, or the quote is not federated to this project).',
      };
    }
    if (res.status === 404) {
      return { ok: false, reason: 'NOT_FOUND', message: 'Customer-Ops has no summary for this quote and project.' };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Customer-Ops quote summary ${req.quoteId} failed ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, reason: 'ERROR', message: `Customer-Ops error ${res.status}.` };
    }

    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== 'object') {
      return { ok: false, reason: 'ERROR', message: 'Customer-Ops returned an unreadable summary.' };
    }
    return {
      ok: true,
      summary: normalizeQuoteSummary(data, {
        customer_ops_quote_id: req.quoteId,
        number: '',
        version: 1,
        share_url: '',
        schedule_ids: [],
      }),
    };
  }
}
