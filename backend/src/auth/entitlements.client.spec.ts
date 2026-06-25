import { UserRole } from '@prisma/client';
import {
  resolveEntitlement,
  mapEntitlementRole,
  ucEntitlementsUrl,
  projectOpsFeatureKey,
  entitlementsEnabled,
  entitlementsFailOpen,
  DEFAULT_PROJECT_OPS_FEATURE_KEY,
} from './entitlements.client';

const env =
  (vars: Record<string, string | undefined>) =>
  (k: string): string | undefined =>
    vars[k];

const silent = { log: () => {}, warn: () => {}, error: () => {} };

/** Minimal fetch Response stand-in. */
const resp = (status: number, body?: unknown, opts?: { badJson?: boolean }) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (opts?.badJson) throw new Error('unexpected token < in JSON');
      return body;
    },
  }) as unknown as Response;

const ARMED_URL = 'https://api.unicorncommander.ai/api/v1/entitlements';

describe('mapEntitlementRole', () => {
  it('maps owner -> ADMIN (case-insensitive)', () => {
    expect(mapEntitlementRole('owner')).toBe(UserRole.ADMIN);
    expect(mapEntitlementRole('Owner')).toBe(UserRole.ADMIN);
    expect(mapEntitlementRole('  OWNER ')).toBe(UserRole.ADMIN);
  });

  it('maps every other org role -> STAFF (never MANAGER/CLIENT)', () => {
    for (const r of ['admin', 'billing_admin', 'member', 'something-else', '', undefined, null]) {
      expect(mapEntitlementRole(r as any)).toBe(UserRole.STAFF);
    }
  });
});

describe('config helpers', () => {
  it('ucEntitlementsUrl trims whitespace + trailing slashes, null when unset', () => {
    expect(ucEntitlementsUrl(env({}))).toBeNull();
    expect(ucEntitlementsUrl(env({ UC_ENTITLEMENTS_URL: '   ' }))).toBeNull();
    expect(ucEntitlementsUrl(env({ UC_ENTITLEMENTS_URL: `  ${ARMED_URL}/// ` }))).toBe(ARMED_URL);
  });

  it('projectOpsFeatureKey defaults to project_ops_access', () => {
    expect(projectOpsFeatureKey(env({}))).toBe(DEFAULT_PROJECT_OPS_FEATURE_KEY);
    expect(projectOpsFeatureKey(env({ PROJECT_OPS_FEATURE_KEY: 'po_premium' }))).toBe('po_premium');
  });

  it('entitlementsEnabled requires BOTH the flag and a URL', () => {
    expect(entitlementsEnabled(env({}))).toBe(false);
    expect(entitlementsEnabled(env({ PROJECT_OPS_ENTITLEMENTS_ENABLED: 'true' }))).toBe(false); // no URL
    expect(entitlementsEnabled(env({ UC_ENTITLEMENTS_URL: ARMED_URL }))).toBe(false); // flag off
    expect(
      entitlementsEnabled(env({ PROJECT_OPS_ENTITLEMENTS_ENABLED: 'true', UC_ENTITLEMENTS_URL: ARMED_URL })),
    ).toBe(true);
    expect(
      entitlementsEnabled(env({ PROJECT_OPS_ENTITLEMENTS_ENABLED: '1', UC_ENTITLEMENTS_URL: ARMED_URL })),
    ).toBe(true);
    expect(
      entitlementsEnabled(env({ PROJECT_OPS_ENTITLEMENTS_ENABLED: 'no', UC_ENTITLEMENTS_URL: ARMED_URL })),
    ).toBe(false);
  });

  it('entitlementsFailOpen defaults to false (fail closed)', () => {
    expect(entitlementsFailOpen(env({}))).toBe(false);
    expect(entitlementsFailOpen(env({ PROJECT_OPS_ENTITLEMENTS_FAIL_OPEN: 'true' }))).toBe(true);
  });
});

describe('resolveEntitlement', () => {
  const armed = env({ UC_ENTITLEMENTS_URL: ARMED_URL });

  it('is indeterminate when the URL is unset (never throws)', async () => {
    const r = await resolveEntitlement('tok', { getEnv: env({}), logger: silent });
    expect(r.outcome).toBe('indeterminate');
    expect(r.reason).toMatch(/UC_ENTITLEMENTS_URL unset/);
  });

  it('is indeterminate when there is no bearer token to forward', async () => {
    const r = await resolveEntitlement('', { getEnv: armed, logger: silent });
    expect(r.outcome).toBe('indeterminate');
    expect(r.reason).toMatch(/no bearer token/);
  });

  it('ALLOWS a 200 whose entitlements include the feature key, mapping the role + parsing org/tier', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      resp(200, {
        org_id: 'org-123',
        tier: 'managed',
        role: 'owner',
        entitlements: ['project_ops_access', 'contact_ops_access'],
      }),
    );
    const r = await resolveEntitlement('uchub-bearer', { getEnv: armed, logger: silent, fetchImpl });

    expect(r.outcome).toBe('allowed');
    expect(r.role).toBe(UserRole.ADMIN);
    expect(r.orgId).toBe('org-123');
    expect(r.tier).toBe('managed');

    // Forwards the uchub Bearer on a GET to the configured URL.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchImpl.mock.calls[0];
    expect(calledUrl).toBe(ARMED_URL);
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer uchub-bearer');
  });

  it('maps a non-owner entitled org role to STAFF', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(resp(200, { org_id: 'o', tier: 'team', role: 'member', entitlements: ['project_ops_access'] }));
    const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
    expect(r.outcome).toBe('allowed');
    expect(r.role).toBe(UserRole.STAFF);
  });

  it('ALLOWS when the list is named feature_keys instead of entitlements', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(resp(200, { org_id: 'o', tier: 'managed', role: 'owner', feature_keys: ['project_ops_access'] }));
    const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
    expect(r.outcome).toBe('allowed');
    expect(r.role).toBe(UserRole.ADMIN);
  });

  it('ALLOWS when the payload is nested under data', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(resp(200, { data: { org_id: 'o', tier: 'team', role: 'member', entitlements: ['project_ops_access'] } }));
    const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
    expect(r.outcome).toBe('allowed');
    expect(r.role).toBe(UserRole.STAFF);
    expect(r.orgId).toBe('o');
  });

  it('honors a custom PROJECT_OPS_FEATURE_KEY', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(resp(200, { entitlements: ['po_premium'], role: 'owner' }));
    const getEnv = env({ UC_ENTITLEMENTS_URL: ARMED_URL, PROJECT_OPS_FEATURE_KEY: 'po_premium' });
    const r = await resolveEntitlement('t', { getEnv, logger: silent, fetchImpl });
    expect(r.outcome).toBe('allowed');
  });

  it('DENIES a 200 whose entitlements omit the feature key', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(resp(200, { org_id: 'o', tier: 'free', role: 'owner', entitlements: ['contact_ops_access'] }));
    const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
    expect(r.outcome).toBe('denied');
    expect(r.role).toBeNull();
    expect(r.reason).toMatch(/lacks 'project_ops_access'/);
  });

  it('DENIES a 401/403 token rejection (definitive, not an outage)', async () => {
    for (const status of [401, 403]) {
      const fetchImpl = jest.fn().mockResolvedValue(resp(status));
      const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
      expect(r.outcome).toBe('denied');
      expect(r.reason).toMatch(new RegExp(`status ${status}`));
    }
  });

  it('is INDETERMINATE on a 5xx (an outage, not a verdict)', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resp(503));
    const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
    expect(r.outcome).toBe('indeterminate');
  });

  it('is INDETERMINATE when the network throws', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
    expect(r.outcome).toBe('indeterminate');
    expect(r.reason).toMatch(/unreachable/);
  });

  it('is INDETERMINATE when the body is not JSON', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(resp(200, undefined, { badJson: true }));
    const r = await resolveEntitlement('t', { getEnv: armed, logger: silent, fetchImpl });
    expect(r.outcome).toBe('indeterminate');
    expect(r.reason).toMatch(/not JSON/);
  });
});
