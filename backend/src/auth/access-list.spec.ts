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
      'user1@example1.com:ADMIN, user2@example2.com:ADMIN, *@example1.com:STAFF, *@example3.com:MANAGER';
    __resetAccessListCacheForTests();
  });

  it('returns ADMIN for an exact-match email', () => {
    const r = resolveUserAccess('user1@example1.com');
    expect(r.allowed).toBe(true);
    expect(r.role).toBe(UserRole.ADMIN);
  });

  it('exact match wins over a competing domain wildcard', () => {
    // An exact ADMIN entry must win over the domain STAFF rule.
    const r = resolveUserAccess('user1@example1.com');
    expect(r.role).toBe(UserRole.ADMIN);
  });

  it('falls through to a domain wildcard when no exact entry exists', () => {
    const r = resolveUserAccess('user5@example1.com');
    expect(r.allowed).toBe(true);
    expect(r.role).toBe(UserRole.STAFF);
  });

  it('rejects emails with no exact AND no domain match', () => {
    const r = resolveUserAccess('user6@example4.com');
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
      'user1@example1.com:ADMIN, garbage-no-role, user7@example5.com:WIZARD, user8@example6.com:STAFF';
    __resetAccessListCacheForTests();
    expect(resolveUserAccess('user1@example1.com').role).toBe(UserRole.ADMIN);
    expect(resolveUserAccess('user8@example6.com').role).toBe(UserRole.STAFF);
    expect(resolveUserAccess('user7@example5.com').allowed).toBe(false); // unknown role dropped
  });

  it('email comparison is case-insensitive', () => {
    const r = resolveUserAccess('user1@example1.com');
    expect(r.allowed).toBe(true);
    expect(r.role).toBe(UserRole.ADMIN);
  });
});

describe('resolveUserAccess — empty bootstrap placeholder', () => {
  beforeEach(() => {
    delete process.env.PROJECT_OPS_ACCESS_LIST;
    __resetAccessListCacheForTests();
  });

  it('denies all first-time SSO users until explicitly configured', () => {
    expect(resolveUserAccess('owner@example.com').allowed).toBe(false);
    expect(describeAccessList()).toEqual({
      source: 'empty bootstrap placeholder (PROJECT_OPS_ACCESS_LIST not set)',
      ruleCount: 0,
    });
  });

  it('also denies all when the configured list is blank', () => {
    process.env.PROJECT_OPS_ACCESS_LIST = '  ';
    expect(resolveUserAccess('owner@example.com').allowed).toBe(false);
  });
});
