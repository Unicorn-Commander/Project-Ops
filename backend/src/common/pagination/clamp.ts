/**
 * Pagination guardrails shared by list endpoints.
 *
 * Audit finding: several list endpoints accepted an unbounded `limit`, letting
 * a caller request `?limit=1000` (or larger) and pull the whole table in one
 * round-trip — a memory/latency footgun and a trivial amplification vector.
 * These helpers normalize a possibly-missing / out-of-range page size into a
 * safe, bounded value so a controller can clamp once at the edge.
 *
 * Kept dependency-free and pure so it is cheap to unit test and safe to import
 * anywhere without dragging in Nest/Prisma.
 */

/** Default page size when the caller does not supply a valid `limit`. */
export const DEFAULT_PAGE_SIZE = 20;

/** Hard upper bound on any list `limit` (audit cap). */
export const MAX_PAGE_SIZE = 100;

/**
 * Clamp a requested page size into `[1, max]`, defaulting when absent/invalid.
 *
 * Non-finite, non-positive, or non-integer inputs fall back to `fallback`; the
 * value is then floored and capped at `max`. Never returns < 1.
 */
export function clampLimit(
  limit: number | undefined | null,
  fallback: number = DEFAULT_PAGE_SIZE,
  max: number = MAX_PAGE_SIZE,
): number {
  const safeFallback = Math.min(Math.max(1, Math.floor(fallback)), max);

  if (limit === undefined || limit === null || !Number.isFinite(limit) || limit <= 0) {
    return safeFallback;
  }

  return Math.min(Math.floor(limit), max);
}

/**
 * Normalize a requested zero-based offset into a non-negative integer.
 * Non-finite / negative inputs become 0.
 */
export function clampOffset(offset: number | undefined | null): number {
  if (offset === undefined || offset === null || !Number.isFinite(offset) || offset <= 0) {
    return 0;
  }
  return Math.floor(offset);
}
