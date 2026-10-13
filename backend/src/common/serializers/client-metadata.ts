/**
 * CLIENT-role serializers for quote / internal metadata.
 *
 * Project-Ops stores Customer-Ops foreign ids on `project.metadata.quote` and
 * `task.metadata.quote` (customer_ops_quote_id, customer_ops_line_id,
 * schedule_ids). A CLIENT caller must never receive those ids — or the studio
 * commercial columns the quotes seam writes onto the project row — on MCP or
 * REST. Staff/admin responses are returned untouched.
 *
 * The project mask is a whitelist of client-safe quote keys (number, version,
 * share_url) plus a blocklist of commercial columns. The task mask is a
 * whitelist of client-safe quote-line keys (number, version, line_kind,
 * position, weeks) and drops foreign ids wherever they appear.
 *
 * MASKING STRATEGY (L2b decision, documented): we use a **recursive blocklist**
 * for task `metadata` and a **blocklist of commercial columns** for the project
 * row — NOT a full allowlist serializer. Rationale:
 *   - An allowlist on every read route would have to enumerate each client-safe
 *     Task/Project field and would silently drop any column added later (a
 *     fail-open client contract we can't maintain across the suite).
 *   - A recursive blocklist instead drops the KNOWN foreign ids
 *     (customer_ops_quote_id / customer_ops_line_id / schedule_ids) at ANY depth
 *     of the metadata bag and treats the `quote` subtree as a narrow allowlist
 *     (CLIENT_TASK_QUOTE_KEYS), because that is the one known, Customer-Ops-
 *     owned place foreign ids are written. This is fail-closed for the ids we
 *     must protect (they are uniquely ours to mint) and forward-compatible with
 *     new, client-safe metadata keys.
 */

import { User, UserRole } from '@prisma/client';
import {
  maskProjectQuoteRefForClient,
  readProjectQuoteRef,
} from '../../customer-ops/quote-summary';

/**
 * Studio commercial columns a CLIENT must never receive (QUOTES-CONTRACT-v1
 * §5). The quote seam writes the A14 hourly rate into `defaultBillRate`.
 */
export const CLIENT_MASKED_PROJECT_FIELDS = [
  'defaultBillRate',
  'budgetAmount',
  'budgetHours',
  'billByDefault',
  'billingNotes',
  'flatFeeAmount',
  'flatFeeInvoicedAt',
  'customerOpsCustomerId',
  'contactOpsContactId',
] as const;

/** New invoice-source columns are internal; CLIENTs see invoice projections instead. */
export const CLIENT_MASKED_TASK_FIELDS = [
  'fixedAmount',
  'invoicedAt',
  'invoiceExternalRef',
] as const;

/** Client-safe keys on task.metadata.quote (no foreign ids). */
export const CLIENT_TASK_QUOTE_KEYS = [
  'number',
  'version',
  'line_kind',
  'position',
  'weeks',
] as const;

const FOREIGN_ID_KEYS = new Set(['customer_ops_quote_id', 'customer_ops_line_id', 'schedule_ids']);

/**
 * Quotes & Proposals seam: surface `metadata.quote` as top-level `quote` too.
 * A CLIENT sees number/version/share_url only — on BOTH `quote` and
 * `metadata.quote` — and loses the staff-only project columns.
 */
export function withProjectQuote<T extends { metadata: unknown }>(
  project: T,
  user: Pick<User, 'role'>,
): T & { quote: unknown } {
  const ref = readProjectQuoteRef(project.metadata);
  if (user.role !== UserRole.CLIENT) {
    return { ...project, quote: ref };
  }

  const row = { ...project } as Record<string, unknown>;
  for (const field of CLIENT_MASKED_PROJECT_FIELDS) delete row[field];

  // The GET /projects list attaches a `budgetSummary` rollup (budgetHours /
  // budgetAmount / loggedHours / pctHours) for the master-schedule UI. That is
  // studio-commercial too — a CLIENT must not receive money or hour-budget
  // figures through it — so drop the whole rollup. `taskStats` (total/completed
  // task counts) stays: it is neutral progress, not commercial.
  delete row.budgetSummary;

  const masked = ref ? maskProjectQuoteRefForClient(ref) : null;
  const meta = row.metadata;
  if (meta && typeof meta === 'object' && 'quote' in (meta as Record<string, unknown>)) {
    const rest = { ...(meta as Record<string, unknown>) };
    delete rest.quote;
    row.metadata = masked ? { ...rest, quote: masked } : rest;
  }
  row.quote = masked;
  return row as T & { quote: unknown };
}

/**
 * Whitelist a `quote` subtree to the client-safe line keys. `quote` is the one
 * metadata key Customer-Ops writes foreign ids into, so an allowlist there is
 * the fail-closed default; every other key is passed through (or recursed into)
 * by the blocklist above.
 */
function maskQuoteSubtreeForClient(q: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const key of CLIENT_TASK_QUOTE_KEYS) {
    if (key in q) masked[key] = maskMetadataValueForClient(q[key]);
  }
  return masked;
}

/**
 * Recursive blocklist over a JSON-ish metadata bag. Drops the foreign-id keys
 * at ANY depth (arrays and nested objects included) and whitelists `quote`
 * subtrees; everything else passes through unchanged. Primitives and arrays of
 * primitives are returned as-is (arrays are mapped so ids inside them are still
 * stripped).
 */
function maskMetadataValueForClient(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(maskMetadataValueForClient);
  if (typeof value !== 'object') return value;

  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (FOREIGN_ID_KEYS.has(k)) continue;
    if (k === 'quote' && v && typeof v === 'object' && !Array.isArray(v)) {
      const masked = maskQuoteSubtreeForClient(v as Record<string, unknown>);
      if (Object.keys(masked).length > 0) out.quote = masked;
      continue;
    }
    out[k] = maskMetadataValueForClient(v);
  }
  return out;
}

/** Strip quote foreign ids from a JSON-ish metadata bag. Staff: identity. */
export function maskTaskMetadataForClient(metadata: unknown): unknown {
  return maskMetadataValueForClient(metadata);
}

export function withTaskMetadataForRole<T>(task: T, user: Pick<User, 'role'>): T {
  if (user.role !== UserRole.CLIENT) return task;
  if (task === null || typeof task !== 'object') return task;
  const row = { ...(task as Record<string, unknown>) };
  for (const field of CLIENT_MASKED_TASK_FIELDS) delete row[field];
  const metadata = (task as { metadata?: unknown } | null | undefined)?.metadata;
  if (metadata !== undefined && metadata !== null) {
    row.metadata = maskTaskMetadataForClient(metadata);
  }
  return row as T;
}
