import { createHash } from 'crypto';

/**
 * Deterministic, retry-safe idempotency key for a billable rollup.
 *
 * Hashing the exact set of source ids means a re-run of the SAME billable set
 * produces the SAME external_ref → Accounting-Ops treats it as a no-op and
 * never double-bills. Newly approved work forms a different set → a different
 * ref → a new invoice. Order-independent (ids are sorted).
 */
export function buildExternalRef(
  workspaceId: string,
  scope: { projectId?: string | null; clientId?: string | null },
  sourceIds: string[],
): string {
  const scopeKey = scope.projectId ? `p-${scope.projectId}` : `c-${scope.clientId}`;
  const hash = createHash('sha256')
    .update([...sourceIds].sort().join(','))
    .digest('hex')
    .slice(0, 16);
  return `po:${workspaceId}:${scopeKey}:${hash}`;
}
