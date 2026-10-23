/**
 * SSO first-login access list: exact email rules precede domain wildcards.
 * Example: PROJECT_OPS_ACCESS_LIST="owner@example.com:ADMIN,*@example.com:STAFF"
 * Unset means deny all. The self-host entrypoint replaces this empty bootstrap
 * placeholder with the generated local admin identity; OIDC operators can set
 * an explicit list. Password login uses the stored user and bcrypt hash.
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

const BOOTSTRAP_PLACEHOLDER: AccessRule[] = [];

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
    cachedRules = BOOTSTRAP_PLACEHOLDER;
    cachedSource = 'empty bootstrap placeholder (PROJECT_OPS_ACCESS_LIST not set)';
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
