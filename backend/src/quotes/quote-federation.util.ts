import { HttpException, HttpStatus } from '@nestjs/common';
import {
  CachedQuoteSummary,
  ProjectQuoteRef,
  blendRecurringMonthly,
} from '../customer-ops/quote-summary';
import { QuoteAcceptedDto, QuoteLineDto } from './dto/quote-accepted.dto';

/**
 * Pure helpers for the quote.accepted adapter. No I/O, no Nest DI — every rule
 * here is unit-tested on its own (quote-federation.util.spec.ts).
 */

/** The only federation actor allowed to federate a quote acceptance (§3). */
export const QUOTE_FEDERATION_ACTOR = 'customer-ops';

/**
 * Project/Task/Document `createdById` are hard FKs to `users`, and the
 * federation principal is synthetic (no row). The adapter therefore attributes
 * its writes to ONE deterministic, non-login service user, upserted lazily on
 * first use. No password, no Keycloak link, a reserved `.invalid` TLD
 * (RFC 2606) — it can never sign in, mint a PAT, or be matched by SSO.
 */
export const QUOTE_FEDERATION_USER = {
  username: 'federation:customer-ops',
  email: 'customer-ops@federation.invalid',
  firstName: 'Customer-Ops',
  lastName: 'Federation',
} as const;

/** Decoded PDF size cap (bytes). The Document store caps uploads at 100 MB; a quote PDF is far smaller. */
export const QUOTE_PDF_MAX_BYTES = 25 * 1024 * 1024;

/** ISO 4217 currencies with 0 or 3+ minor-unit digits — rejected in v1 (Amendment 01 A17). */
export const NON_TWO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  // zero-decimal
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
  // three-decimal
  'BHD',
  'IQD',
  'JOD',
  'KWD',
  'LYD',
  'OMR',
  'TND',
  // four-decimal
  'CLF',
  'UYW',
]);

/** A classified, machine-readable failure (Amendment 01 A7: Customer-Ops records `federated.project_ops = failed` + reason). */
export function federationError(
  httpStatus: HttpStatus,
  code: string,
  reason: string,
): HttpException {
  return new HttpException({ status: 'failed', code, reason }, httpStatus);
}

/** Upper-case, validated ISO 4217 code; throws UNSUPPORTED_CURRENCY for non-2-decimal currencies. */
export function normalizeCurrency(raw: string): string {
  const code = (raw ?? '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw federationError(
      HttpStatus.BAD_REQUEST,
      'UNSUPPORTED_CURRENCY',
      `Currency '${raw}' is not a 3-letter ISO 4217 code.`,
    );
  }
  if (NON_TWO_DECIMAL_CURRENCIES.has(code)) {
    throw federationError(
      HttpStatus.BAD_REQUEST,
      'UNSUPPORTED_CURRENCY',
      `Currency ${code} is not a 2-decimal currency; v1 supports 2-decimal currencies only (Amendment 01 A17).`,
    );
  }
  return code;
}

/** Integer cents → a Decimal-safe string ("1234567" → "12345.67"). Never floats. */
export function centsToAmountString(cents: number): string {
  if (!Number.isInteger(cents) || cents < 0) {
    throw federationError(
      HttpStatus.BAD_REQUEST,
      'INVALID_AMOUNT',
      `Amount ${cents} is not a non-negative integer number of cents.`,
    );
  }
  const whole = Math.floor(cents / 100);
  const minor = cents % 100;
  return `${whole}.${minor.toString().padStart(2, '0')}`;
}

/** billingNotes exactly as the contract words it: "Quote <number> v<version>: <schedule_text>". */
export function buildBillingNotes(number: string, version: number, scheduleText: string): string {
  return `Quote ${number} v${version}: ${(scheduleText ?? '').trim()}`;
}

/**
 * The lines that become tasks (A16): accepted `one_time` + `milestone` lines
 * only, never an unselected option line, in ascending `position` (stable for
 * equal positions — input order is preserved).
 */
export function selectTaskLines(lines: ReadonlyArray<QuoteLineDto>): QuoteLineDto[] {
  return lines
    .map((line, index) => ({ line, index }))
    .filter(
      ({ line }) =>
        (line.kind === 'one_time' || line.kind === 'milestone') && line.selected !== false,
    )
    .sort((a, b) => a.line.position - b.line.position || a.index - b.index)
    .map(({ line }) => line);
}

/** Idempotent union: existing order kept, new ids appended once, blanks/dupes dropped. */
export function mergeScheduleIds(
  existing: unknown,
  incoming: ReadonlyArray<string> | undefined,
): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && !out.includes(v)) out.push(v);
  };
  if (Array.isArray(existing)) existing.forEach(push);
  (incoming ?? []).forEach(push);
  return out;
}

/** True when a merge would change the stored list. */
export function scheduleIdsChanged(existing: unknown, merged: ReadonlyArray<string>): boolean {
  const before = Array.isArray(existing) ? existing.filter((v) => typeof v === 'string') : [];
  return before.length !== merged.length || before.some((v, i) => v !== merged[i]);
}

/** `project.metadata.quote` — foreign ids only (§3), plus the Accounting-Ops schedule ids (A14). */
export function buildQuoteRef(
  dto: QuoteAcceptedDto,
  scheduleIds: ReadonlyArray<string>,
): ProjectQuoteRef {
  return {
    customer_ops_quote_id: dto.customer_ops_quote_id,
    number: dto.number,
    version: dto.version,
    share_url: dto.share_url,
    schedule_ids: [...scheduleIds],
  };
}

/**
 * The blended per-month figure for the cached summary. Delegates to the ONE
 * implementation of the rule (`blendRecurringMonthly`), so the adapter and the
 * summary reader cannot drift apart on the formula OR on the tie-break (L10):
 * `billing.recurring[]` wins over the pre-blended
 * `billing.recurring_monthly_cents`, and the formula is
 * `month + quarter/3 + year/12`, rounded — byte-for-byte `computeQuote`'s
 * `monthly_equivalent_cents`, so the cached tile and the live tile agree.
 *
 * Per-interval detail is deliberately NOT cached: §3 keeps recurring lines as
 * narrative in `billingNotes` in v1, and the panel reads the detail through to
 * Customer-Ops.
 */
export function recurringMonthlyCents(billing: QuoteAcceptedDto['billing']): number {
  return blendRecurringMonthly(billing);
}

/**
 * `project.metadata.quoteSummary` — the small cached summary, client-whitelisted
 * by construction (a CLIENT reading project metadata over MCP sees only what the
 * portal panel would show).
 *
 * `billing.deposit_cents` is deliberately NOT stored: the deposit is
 * Accounting-Ops' paper (§3), not a Project-Ops field, so the staff panel reads
 * it live off the Customer-Ops summary rather than Project-Ops keeping a second
 * copy that can go stale. It is accepted on the wire so a spec-shaped payload
 * validates and so the adapter can cross-check it in a later version.
 */
export function buildQuoteSummaryCache(
  dto: QuoteAcceptedDto,
  currency: string,
): CachedQuoteSummary {
  return {
    title: dto.title,
    currency,
    status: 'accepted',
    totals: {
      one_time_total_cents: dto.billing.one_time_total_cents,
      milestone_total_cents: dto.billing.milestone_total_cents,
      recurring_monthly_cents: recurringMonthlyCents(dto.billing),
    },
  };
}

/** Keep a file name safe for an object key + a download header. */
export function safeFileName(name: string, fallback = 'quote.pdf'): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[^A-Za-z0-9._ -]+/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const withExt = cleaned.toLowerCase().endsWith('.pdf')
    ? cleaned
    : `${cleaned || fallback.replace(/\.pdf$/i, '')}.pdf`;
  return withExt.slice(0, 200);
}

/** One key per (workspace, quote, version, file) — a retry overwrites the same object; never a second one. */
export function quotePdfObjectKey(
  workspaceId: string,
  quoteId: string,
  version: number,
  fileName: string,
): string {
  const seg = (v: string) => encodeURIComponent(v).replace(/%/g, '_');
  return `quotes/${seg(workspaceId)}/${seg(quoteId)}/v${version}/${seg(safeFileName(fileName))}`;
}

/** The pg advisory-lock key serialising concurrent accepts of the same (workspace, quote, version). */
export function acceptLockKey(workspaceId: string, quoteId: string, version: number): string {
  return `project-ops:quote-accept:${workspaceId}:${quoteId}:${version}`;
}

/** Task metadata: enough to trace a task back to its quote line, nothing that duplicates the line. */
export function buildTaskQuoteMetadata(dto: QuoteAcceptedDto, line: QuoteLineDto) {
  return {
    quote: {
      customer_ops_quote_id: dto.customer_ops_quote_id,
      number: dto.number,
      version: dto.version,
      line_kind: line.kind,
      position: line.position,
      ...(line.weeks !== undefined ? { weeks: line.weeks } : {}),
      ...(line.customer_ops_line_id ? { customer_ops_line_id: line.customer_ops_line_id } : {}),
      ...(line.option_group ? { option_group: line.option_group } : {}),
    },
  };
}

/** Sort task rows by their recorded quote position (fallback: creation order). */
export function sortTasksByQuotePosition<T extends { metadata: unknown; createdAt?: Date }>(
  tasks: T[],
): T[] {
  const pos = (t: T): number => {
    const p = (t.metadata as any)?.quote?.position;
    return typeof p === 'number' && Number.isFinite(p) ? p : Number.MAX_SAFE_INTEGER;
  };
  return [...tasks].sort(
    (a, b) => pos(a) - pos(b) || (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0),
  );
}

/** Magic-bytes check so a broken upstream render never lands as "the accepted PDF". */
export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}
