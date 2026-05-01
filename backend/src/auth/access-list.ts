/**
 * SSO access list — single source of truth for "who can sign into
 * Project-Ops at all" + "what role do they get on first JIT".
 *
 * Sourced from the `PROJECT_OPS_ACCESS_LIST` env var, parsed once at
 * startup. Format is comma-separated `email-or-pattern:role` pairs:
 *
 *   PROJECT_OPS_ACCESS_LIST="
 *     aaron@magicunicorn.tech:ADMIN,
 *     shafenkhan@users.noreply.github.com:ADMIN,
 *     *@magicunicorn.tech:STAFF,
 *     *@partner.example.com:STAFF
 *   "
 *
 * Resolution order:
 *   1. Exact email match wins.
 *   2. Domain wildcard (`*@domain.tld`) matches if no exact entry.
 *   3. If neither matches, the user is NOT authorized — JIT
 *      provisioning is rejected with 401. This is the intentional
 *      gate: just because someone has a Keycloak account in the
 *      shared `uchub` realm doesn't mean they get a Project-Ops
 *      account. Project-Ops is single-tenant internal; the
 *      allowlist defines the tenant.
 *
 * If the env var is unset, falls back to the legacy hard-coded map
 * (Aaron + Shafen as ADMIN, everyone else CLIENT) so a misconfigured
 * deploy doesn't lock everyone out — but logs a warning so it's
 * obvious in the boot logs.
 */

import { UserRole } from '@prisma/client';

export interface AccessResolution {
  allowed: boolean;
  role: UserRole;
  reason: string;
}

interface AccessRule {
  pattern: string;
  isDomain: boolean;
  domain: string | null;
  role: UserRole;
}

const VALID_ROLES = new Set<string>(Object.values(UserRole));

const LEGACY_FALLBACK: AccessRule[] = [
  { pattern: 'aaron@magicunicorn.tech', isDomain: false, domain: null, role: UserRole.ADMIN },
  { pattern: 'shafenkhan@users.noreply.github.com',  isDomain: false, domain: null, role: UserRole.ADMIN },
];

let cachedRules: AccessRule[] | null = null;
let cachedSource: string | null = null;

function parseAccessList(raw: string): AccessRule[] {
  const rules: AccessRule[] = [];
  for (const tokenRaw of raw.split(',')) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const [patternRaw, roleRaw] = token.split(':').map((s) => s?.trim());
    if (!patternRaw || !roleRaw) continue;
    const role = roleRaw.toUpperCase();
    if (!VALID_ROLES.has(role)) continue;
    const pattern = patternRaw.toLowerCase();
    const isDomain = pattern.startsWith('*@');
    rules.push({
      pattern,
      isDomain,
      domain: isDomain ? pattern.slice(2) : null,
      role: role as UserRole,
    });
  }
  return rules;
}

function getRules(): { rules: AccessRule[]; source: string } {
  if (cachedRules !== null && cachedSource !== null) {
    return { rules: cachedRules, source: cachedSource };
  }
  const raw = process.env.PROJECT_OPS_ACCESS_LIST?.trim();
  if (raw) {
    cachedRules = parseAccessList(raw);
    cachedSource = 'env:PROJECT_OPS_ACCESS_LIST';
  } else {
    cachedRules = LEGACY_FALLBACK;
    cachedSource = 'legacy fallback (PROJECT_OPS_ACCESS_LIST not set)';
  }
  return { rules: cachedRules, source: cachedSource };
}

/**
 * Test-only: clears the cached rules so a follow-up call re-reads
 * `process.env.PROJECT_OPS_ACCESS_LIST`. Production code should never
 * call this — the cache is intentional.
 */
export function __resetAccessListCacheForTests(): void {
  cachedRules = null;
  cachedSource = null;
}

/**
 * Resolve whether `email` is allowed to JIT-provision a Project-Ops
 * account, and what role they should get.
 */
export function resolveUserAccess(email: string | null | undefined): AccessResolution {
  if (!email) {
    return { allowed: false, role: UserRole.CLIENT, reason: 'no email on Keycloak profile' };
  }
  const lower = email.toLowerCase();
  const { rules, source } = getRules();

  // Exact match wins
  const exact = rules.find((r) => !r.isDomain && r.pattern === lower);
  if (exact) {
    return {
      allowed: true,
      role: exact.role,
      reason: `exact match in ${source} → ${exact.role}`,
    };
  }

  // Domain wildcard fallback
  const at = lower.indexOf('@');
  const domain = at >= 0 ? lower.slice(at + 1) : null;
  if (domain) {
    const wild = rules.find((r) => r.isDomain && r.domain === domain);
    if (wild) {
      return {
        allowed: true,
        role: wild.role,
        reason: `domain match (*@${domain}) in ${source} → ${wild.role}`,
      };
    }
  }

  return {
    allowed: false,
    role: UserRole.CLIENT,
    reason: `no rule in ${source} matched ${lower}`,
  };
}

/**
 * Inspect the resolved rule set — exposed for the boot-time log line
 * + `/api/v1/health/access-list` debug endpoint if we add one.
 */
export function describeAccessList(): { source: string; ruleCount: number } {
  const { rules, source } = getRules();
  return { source, ruleCount: rules.length };
}
