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
] as const;

/** Client-safe keys on task.metadata.quote (no foreign ids). */
export const CLIENT_TASK_QUOTE_KEYS = [
  'number',
  'version',
  'line_kind',
  'position',
  'weeks',
] as const;

const FOREIGN_ID_KEYS = new Set([
  'customer_ops_quote_id',
  'customer_ops_line_id',
  'schedule_ids',
]);

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

/** Strip quote foreign ids from a JSON-ish metadata bag. Staff: identity. */
export function maskTaskMetadataForClient(metadata: unknown): unknown {
  if (metadata === null || metadata === undefined) return metadata;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
  const src = metadata as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (FOREIGN_ID_KEYS.has(k)) continue;
    if (k === 'quote' && v && typeof v === 'object' && !Array.isArray(v)) {
      const q = v as Record<string, unknown>;
      const masked: Record<string, unknown> = {};
      for (const key of CLIENT_TASK_QUOTE_KEYS) {
        if (key in q) masked[key] = q[key];
      }
      if (Object.keys(masked).length > 0) out.quote = masked;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function withTaskMetadataForRole<T>(task: T, user: Pick<User, 'role'>): T {
  if (user.role !== UserRole.CLIENT) return task;
  const metadata = (task as { metadata?: unknown } | null | undefined)?.metadata;
  if (metadata === undefined || metadata === null) return task;
  return { ...task, metadata: maskTaskMetadataForClient(metadata) } as T;
}
