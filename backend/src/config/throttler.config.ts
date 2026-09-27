import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Rate-limit policy (PO security-hardening item 5).
 *
 * Previously the only global tier was `short` = 10 req / 60s — implausibly low
 * for an authenticated SPA + agent surface, so whole controllers (contacts,
 * mcp, health, version) blanket-`@SkipThrottle`d it, leaving those surfaces
 * with NO limit at all. That is the incoherence we're fixing: pick sane
 * defaults so routes don't need to escape the limiter wholesale, and give the
 * surfaces that genuinely differ their OWN named tier instead of "off".
 *
 * Tiers (keyed by the verified PAT/user principal, or by a trusted client IP
 * for unauthenticated requests, via PrincipalThrottlerGuard):
 *
 *   short  — the GLOBAL interactive default. 120 req / 60s (~2 rps sustained,
 *            with burst). Comfortable for a logged-in UI fanning out several
 *            calls per view; still a real DoS/credential-spray ceiling.
 *            NOTE: the NAME is reused by tight per-route overrides
 *            (`@Throttle({ short: { limit: 5, ttl: 60000 } })` on auth/login,
 *            etc.) — those override the limit for their route only and MUST
 *            keep working, so the name is preserved.
 *
 *   long   — a coarse hourly backstop against slow, sustained abuse that stays
 *            under the per-minute ceiling. 1200 req / hour.
 *
 *   mcp    — the authenticated agent surface (Brigade & MCP clients). A busy
 *            chat issues many tool calls per turn, so it gets a HIGHER ceiling
 *            than the human default — but it is PRESENT, not skipped: these
 *            calls can create projects/tasks and trigger LLM inference, so an
 *            unbounded loop must still be capped. 300 req / 60s.
 *
 * Health/version are probe endpoints; they keep a sensible skip of the human
 * tiers (set per-controller) so container/load-balancer probes never 429.
 */

export const THROTTLER_SHORT = 'short';
export const THROTTLER_LONG = 'long';
export const THROTTLER_MCP = 'mcp';

export const THROTTLER_TIERS: ThrottlerModuleOptions = [
  {
    name: THROTTLER_SHORT,
    ttl: 60_000, // 60 seconds
    limit: 120,
  },
  {
    name: THROTTLER_LONG,
    ttl: 3_600_000, // 1 hour
    limit: 1_200,
  },
  {
    name: THROTTLER_MCP,
    ttl: 60_000, // 60 seconds
    limit: 300,
  },
];
