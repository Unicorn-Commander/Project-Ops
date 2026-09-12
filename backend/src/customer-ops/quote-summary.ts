/**
 * Quote summary shapes for the Quotes & Proposals seam (QUOTES-CONTRACT-v1 §0,
 * §3; Amendment 01 A9/A15).
 *
 * Customer-Ops OWNS the quote. Project-Ops stores foreign ids plus a SMALL
 * cached summary (number, title, totals, status, share URL) on the project's
 * `metadata` and renders everything else by reading through to Customer-Ops
 * (`GET /api/quotes/:id/summary`). This module is the normalised, defensive
 * view of that summary plus the CLIENT-role mask.
 *
 * Money is INTEGER CENTS end to end (never re-derived from tasks or time).
 */

/** Public tax language (Amendment 01 A9) shown next to every totals block. */
export const QUOTE_TAX_NOTE = 'Amounts exclude tax; tax is applied on the invoice.';

/** The foreign-id block Project-Ops stores at `project.metadata.quote`. */
export interface ProjectQuoteRef {
  customer_ops_quote_id: string;
  number: string;
  version: number;
  share_url: string;
  /** Accounting-Ops schedule ids (A14) — may arrive on a later call; merged idempotently. */
  schedule_ids: string[];
}

/** Totals block, integer cents. */
export interface QuoteTotals {
  currency: string;
  one_time_total_cents: number;
  milestone_total_cents: number;
  recurring_monthly_cents: number;
  /** one_time + milestones (the amount Project-Ops mirrors into billingAmount). */
  one_time_plus_milestones_cents: number;
  /** Optional illustration/estimate figures Customer-Ops may compute. */
  year_one_illustration_cents?: number | null;
  deposit_cents?: number | null;
  tax_estimate_cents?: number | null;
  /** Staff-only: the primary hourly line's rate (A14). Never in the client mask. */
  hourly_rate_cents?: number | null;
}

/** The normalised STAFF view of a quote summary (live or cached). */
export interface QuoteSummary {
  customer_ops_quote_id: string;
  number: string;
  version: number;
  title: string;
  status: string;
  totals: QuoteTotals;
  share_url: string;
  valid_until?: string | null;
  accepted_at?: string | null;
  sent_at?: string | null;
  pdf_url?: string | null;
  /** Customer-Ops federation cursor, when the summary carries it (A7). */
  federated?: Record<string, unknown> | null;
}

/**
 * The CLIENT-role view: number, title, totals, status and the share link ONLY
 * (task brief + contract §5). Built by explicit construction — a whitelist —
 * so any extra key on the source (accepted_by, internal notes, split, costs,
 * lines, federation cursors, hourly rate…) is dropped by construction, never
 * by a blocklist that could drift.
 */
export interface ClientQuoteSummary {
  number: string;
  version: number;
  title: string;
  status: string;
  totals: {
    currency: string;
    one_time_total_cents: number;
    milestone_total_cents: number;
    recurring_monthly_cents: number;
    one_time_plus_milestones_cents: number;
  };
  share_url: string;
}

const CLIENT_SUMMARY_KEYS: ReadonlyArray<keyof ClientQuoteSummary> = [
  'number',
  'version',
  'title',
  'status',
  'totals',
  'share_url',
];

/** Exported so tests (and reviewers) can assert the whitelist never widens silently. */
export const CLIENT_QUOTE_SUMMARY_KEYS: ReadonlyArray<string> = CLIENT_SUMMARY_KEYS;

export function maskQuoteSummaryForClient(s: QuoteSummary): ClientQuoteSummary {
  return {
    number: s.number,
    version: s.version,
    title: s.title,
    status: s.status,
    totals: {
      currency: s.totals.currency,
      one_time_total_cents: s.totals.one_time_total_cents,
      milestone_total_cents: s.totals.milestone_total_cents,
      recurring_monthly_cents: s.totals.recurring_monthly_cents,
      one_time_plus_milestones_cents: s.totals.one_time_plus_milestones_cents,
    },
    share_url: s.share_url,
  };
}

// ── Defensive parsing helpers ───────────────────────────────────────────────

function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

function asOptString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

/** Integer cents or 0; tolerates numeric strings ("1234"). Never NaN. */
export function asCents(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Math.round(Number(v));
  return 0;
}

function asOptCents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Math.round(Number(v));
  return null;
}

function asVersion(v: unknown): number {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 1;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.trim() && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Read the foreign-id block off a project's `metadata` (null when the project
 * did not come from a quote). Tolerates a missing/invalid `schedule_ids`.
 */
export function readProjectQuoteRef(metadata: unknown): ProjectQuoteRef | null {
  const q = (metadata as any)?.quote;
  if (!q || typeof q !== 'object') return null;
  const id = asOptString(q.customer_ops_quote_id);
  const number = asOptString(q.number);
  if (!id || !number) return null;
  return {
    customer_ops_quote_id: id,
    number,
    version: asVersion(q.version),
    share_url: asString(q.share_url),
    schedule_ids: asStringArray(q.schedule_ids),
  };
}

/**
 * The cached summary Project-Ops writes at accept time
 * (`metadata.quoteSummary`): title, currency, status, totals — and NOTHING
 * else. Every field is inside the CLIENT whitelist by construction, so the
 * cache itself can never leak (a CLIENT reading project metadata over MCP sees
 * only what the portal panel would show). Rates, acceptance details and
 * schedule text live on the project's billing fields / in Customer-Ops.
 */
export interface CachedQuoteSummary {
  title: string;
  currency: string;
  status: string;
  totals: {
    one_time_total_cents: number;
    milestone_total_cents: number;
    recurring_monthly_cents: number;
  };
}

export function readCachedQuoteSummary(metadata: unknown): CachedQuoteSummary | null {
  const c = (metadata as any)?.quoteSummary;
  if (!c || typeof c !== 'object') return null;
  const t = c.totals && typeof c.totals === 'object' ? c.totals : {};
  return {
    title: asString(c.title),
    currency: asString(c.currency, 'USD'),
    status: asString(c.status, 'accepted'),
    totals: {
      one_time_total_cents: asCents(t.one_time_total_cents),
      milestone_total_cents: asCents(t.milestone_total_cents),
      recurring_monthly_cents: asCents(t.recurring_monthly_cents),
    },
  };
}

/**
 * The CLIENT view of the foreign-id block: number, version and the share link.
 * The Customer-Ops id and the Accounting-Ops schedule ids are internal wiring
 * and are dropped (used by MCP get_project for CLIENT callers).
 */
export function maskProjectQuoteRefForClient(ref: ProjectQuoteRef): {
  number: string;
  version: number;
  share_url: string;
} {
  return { number: ref.number, version: ref.version, share_url: ref.share_url };
}

/** Build the staff view from the ids + cache alone (Customer-Ops unreachable/unconfigured). */
export function summaryFromCache(ref: ProjectQuoteRef, cached: CachedQuoteSummary | null): QuoteSummary {
  const one = cached?.totals.one_time_total_cents ?? 0;
  const ms = cached?.totals.milestone_total_cents ?? 0;
  return {
    customer_ops_quote_id: ref.customer_ops_quote_id,
    number: ref.number,
    version: ref.version,
    title: cached?.title ?? '',
    status: cached?.status ?? 'accepted',
    totals: {
      currency: cached?.currency ?? 'USD',
      one_time_total_cents: one,
      milestone_total_cents: ms,
      recurring_monthly_cents: cached?.totals.recurring_monthly_cents ?? 0,
      one_time_plus_milestones_cents: one + ms,
      hourly_rate_cents: null,
    },
    share_url: ref.share_url,
  };
}

/**
 * Normalise Customer-Ops' `GET /api/quotes/:id/summary` body into QuoteSummary.
 * Tolerant by design: accepts the summary at the top level or under `quote`,
 * totals nested under `totals` or flat, snake_case throughout (the suite wire
 * convention). Unknown keys are ignored — nothing beyond this shape is ever
 * surfaced to a panel.
 */
export function normalizeQuoteSummary(raw: unknown, fallback: ProjectQuoteRef): QuoteSummary {
  const body: any = raw && typeof raw === 'object' ? raw : {};
  const q: any = body.quote && typeof body.quote === 'object' ? body.quote : body;
  const t: any = q.totals && typeof q.totals === 'object' ? q.totals : q;
  const one = asCents(t.one_time_total_cents ?? t.one_time_total);
  const ms = asCents(t.milestone_total_cents ?? t.milestone_total);
  const recurring = asCents(t.recurring_monthly_cents ?? t.recurring_monthly_total_cents ?? t.recurring_monthly_total);
  return {
    customer_ops_quote_id: asString(q.id ?? q.customer_ops_quote_id, fallback.customer_ops_quote_id),
    number: asString(q.number, fallback.number),
    version: asVersion(q.version ?? q.current_version_no ?? q.version_no ?? fallback.version),
    title: asString(q.title),
    status: asString(q.status, 'accepted'),
    totals: {
      currency: asString(q.currency ?? t.currency, 'USD'),
      one_time_total_cents: one,
      milestone_total_cents: ms,
      recurring_monthly_cents: recurring,
      one_time_plus_milestones_cents: one + ms,
      year_one_illustration_cents: asOptCents(t.year_one_illustration_cents ?? t.year_one_illustration),
      deposit_cents: asOptCents(t.deposit_cents),
      tax_estimate_cents: asOptCents(t.tax_estimate_cents),
      hourly_rate_cents: asOptCents(t.hourly_rate_cents),
    },
    share_url: asString(q.share_url, fallback.share_url),
    valid_until: asOptString(q.valid_until),
    accepted_at: asOptString(q.accepted_at),
    sent_at: asOptString(q.sent_at),
    pdf_url: asOptString(q.pdf_url),
    federated: q.federated && typeof q.federated === 'object' ? q.federated : null,
  };
}
