/**
 * Specs for the SSO access list — the gate that decides whether a new
 * Keycloak SSO user gets a Project-Ops account at all, and what role.
 *
 * The tested scenarios are exactly the bug class this exists to
 * prevent: silent privilege escalation (random external Keycloak users
 * landing as ADMIN), silent lockout (env misconfig kicking everyone
 * out), and matching ambiguity (exact vs domain rules disagreeing).
 */

import { UserRole } from '@prisma/client';
import {
  resolveUserAccess,
  describeAccessList,
  __resetAccessListCacheForTests,
} from './access-list';

const ORIGINAL = process.env.PROJECT_OPS_ACCESS_LIST;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PROJECT_OPS_ACCESS_LIST;
  else process.env.PROJECT_OPS_ACCESS_LIST = ORIGINAL;
  __resetAccessListCacheForTests();
});

describe('resolveUserAccess — env-driven allowlist', () => {
  beforeEach(() => {
    process.env.PROJECT_OPS_ACCESS_LIST =
      'aaron@magicunicorn.tech:ADMIN, shafenkhan@users.noreply.github.com:ADMIN, *@magicunicorn.tech:STAFF, *@magicunicorn.dev:MANAGER';
    __resetAccessListCacheForTests();
  });

  it('returns ADMIN for an exact-match email', () => {
    const r = resolveUserAccess('aaron@magicunicorn.tech');
    expect(r.allowed).toBe(true);
    expect(r.role).toBe(UserRole.ADMIN);
  });

  it('exact match wins over a competing domain wildcard', () => {
    // Aaron is ADMIN exactly; the *@magicunicorn.tech wildcard would
    // otherwise downgrade him to STAFF. Exact must win.
    const r = resolveUserAccess('aaron@magicunicorn.tech');
    expect(r.role).toBe(UserRole.ADMIN);
  });

  it('falls through to a domain wildcard when no exact entry exists', () => {
    const r = resolveUserAccess('newhire@magicunicorn.tech');
    expect(r.allowed).toBe(true);
    expect(r.role).toBe(UserRole.STAFF);
  });

  it('rejects emails with no exact AND no domain match', () => {
    const r = resolveUserAccess('outsider@example.com');
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/no rule .* matched/);
  });

  it('rejects empty / null email defensively', () => {
    expect(resolveUserAccess(null).allowed).toBe(false);
    expect(resolveUserAccess(undefined).allowed).toBe(false);
    expect(resolveUserAccess('').allowed).toBe(false);
  });

  it('ignores malformed entries (no colon, unknown role) without throwing', () => {
    process.env.PROJECT_OPS_ACCESS_LIST =
      'aaron@magicunicorn.tech:ADMIN, garbage-no-role, foo@bar.com:WIZARD, valid@test.com:STAFF';
    __resetAccessListCacheForTests();
    expect(resolveUserAccess('aaron@magicunicorn.tech').role).toBe(UserRole.ADMIN);
    expect(resolveUserAccess('valid@test.com').role).toBe(UserRole.STAFF);
    expect(resolveUserAccess('foo@bar.com').allowed).toBe(false); // unknown role dropped
  });

  it('email comparison is case-insensitive', () => {
    const r = resolveUserAccess('AaRon@MagicUnicorn.TECH');
    expect(r.allowed).toBe(true);
    expect(r.role).toBe(UserRole.ADMIN);
  });
});

describe('resolveUserAccess — legacy fallback when env is unset', () => {
  beforeEach(() => {
    delete process.env.PROJECT_OPS_ACCESS_LIST;
    __resetAccessListCacheForTests();
  });

  it('still admits Aaron + Shafen as ADMIN', () => {
    expect(resolveUserAccess('aaron@magicunicorn.tech').role).toBe(UserRole.ADMIN);
    expect(resolveUserAccess('shafenkhan@users.noreply.github.com').role).toBe(UserRole.ADMIN);
  });

  it('rejects everyone else (no implicit CLIENT-grant) and reports legacy source', () => {
    const r = resolveUserAccess('random@example.com');
    expect(r.allowed).toBe(false);
    const meta = describeAccessList();
    expect(meta.source).toMatch(/legacy fallback/);
  });
});
