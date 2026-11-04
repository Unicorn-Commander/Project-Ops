import { ConfigService } from '@nestjs/config';
import { User, UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { NoWorkspaceAccessException } from './no-workspace-access.exception';
import { __resetAccessListCacheForTests } from './access-list';

const REALM_ISSUER = 'https://auth.fictional.example/realms/fictional';
const ENTITLEMENTS_URL = 'https://ops.fictional.example/api/v1/entitlements';
const ORG_ID = '01924a3c-0000-7000-8000-000000000123';
const FIXTURE_BEARER = ['fictional', 'entitled', 'bearer'].join('-');

const entitlementResponse = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
  }) as Response;

function config(overrides: Record<string, string | undefined> = {}): ConfigService {
  const values: Record<string, string | undefined> = {
    PROJECT_OPS_ENTITLEMENTS_ENABLED: 'true',
    UC_ENTITLEMENTS_URL: ENTITLEMENTS_URL,
    PROJECT_OPS_TENANCY_ENABLED: 'true',
    ...overrides,
  };
  return {
    get: <T>(key: string, fallback?: T) =>
      (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback) as T,
  } as unknown as ConfigService;
}

function makeService(overrides: Record<string, string | undefined> = {}) {
  const createdUser = {
    id: 'fictional-local-user',
    email: 'owner@fictional.example',
    username: 'fictional-owner',
    firstName: 'Fictional',
    lastName: 'Owner',
    keycloakId: 'fictional-keycloak-sub',
    role: UserRole.STAFF,
    isActive: true,
  } as User;
  const users = {
    findByKeycloakId: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(createdUser),
  };
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const membership = {
    ensureEntitledWorkspace: jest.fn().mockResolvedValue(ORG_ID),
  };
  const auth = new AuthService(
    users as any,
    {} as any,
    config(overrides),
    prisma as any,
    {} as any,
    membership as any,
  );
  return { auth, createdUser, users, prisma, membership };
}

describe('AuthService bearer entitlement path', () => {
  const originalAccessList = process.env.PROJECT_OPS_ACCESS_LIST;

  beforeEach(() => {
    __resetAccessListCacheForTests();
    delete process.env.PROJECT_OPS_ACCESS_LIST;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    __resetAccessListCacheForTests();
    if (originalAccessList === undefined) delete process.env.PROJECT_OPS_ACCESS_LIST;
    else process.env.PROJECT_OPS_ACCESS_LIST = originalAccessList;
  });

  it('accepts an entitled bearer and provisions its org workspace before the first MCP auth result', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      entitlementResponse({
        org_id: ORG_ID,
        org_name: 'Fictional Acme Studio',
        tier: 'byok',
        role: 'member',
        entitlements: ['project_ops_access'],
      }),
    );
    const { auth, createdUser, membership } = makeService();

    const user = await auth.validateJwtPayload(
      {
        iss: REALM_ISSUER,
        sub: 'fictional-keycloak-sub',
        email: 'owner@fictional.example',
        email_verified: true,
        preferred_username: 'fictional-owner',
      },
      FIXTURE_BEARER,
    );

    expect(user).toBe(createdUser);
    expect(membership.ensureEntitledWorkspace).toHaveBeenCalledWith(
      createdUser,
      ORG_ID,
      UserRole.STAFF,
      'Fictional Acme Studio',
    );
  });

  it('caches one entitlement lookup per bearer across stateless MCP requests', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      entitlementResponse({
        org_id: ORG_ID,
        org_name: 'Fictional Acme Studio',
        tier: 'byok',
        role: 'member',
        entitlements: ['project_ops_access'],
      }),
    );
    const { auth, createdUser, users } = makeService();
    users.findByKeycloakId.mockResolvedValue(createdUser);
    const payload = {
      iss: REALM_ISSUER,
      sub: 'fictional-keycloak-sub',
      email: 'owner@fictional.example',
      email_verified: true,
    };

    await auth.validateJwtPayload(payload, FIXTURE_BEARER);
    await auth.validateJwtPayload(payload, FIXTURE_BEARER);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a verified bearer whose org lacks project_ops_access before user provisioning', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      entitlementResponse({
        org_id: ORG_ID,
        org_name: 'Fictional Acme Studio',
        tier: 'free',
        role: 'member',
        entitlements: ['contact_ops_access'],
      }),
    );
    const { auth, users, membership } = makeService();

    const error = await auth
      .validateJwtPayload(
        {
          iss: REALM_ISSUER,
          sub: 'fictional-unentitled-sub',
          email: 'member@fictional.example',
          email_verified: true,
        },
        ['fictional', 'unentitled', 'bearer'].join('-'),
      )
      .then(
        () => null,
        (caught) => caught,
      );

    expect(error).toBeInstanceOf(NoWorkspaceAccessException);
    expect((error as NoWorkspaceAccessException).getStatus()).toBe(403);
    expect((error as NoWorkspaceAccessException).getResponse()).toMatchObject({
      error: 'no_workspace_access',
    });
    expect(users.findByKeycloakId).not.toHaveBeenCalled();
    expect(membership.ensureEntitledWorkspace).not.toHaveBeenCalled();
  });

  it('keeps the static allowlist behavior when entitlements are disabled', async () => {
    process.env.PROJECT_OPS_ACCESS_LIST = 'allowlisted@fictional.example:ADMIN';
    const fetchMock = jest.spyOn(global, 'fetch');
    const { auth, users, membership } = makeService({
      PROJECT_OPS_ENTITLEMENTS_ENABLED: 'false',
      PROJECT_OPS_TENANCY_ENABLED: 'false',
    });

    await auth.validateKeycloakUser(
      'fictional-keycloak-sub',
      {
        email: 'allowlisted@fictional.example',
        email_verified: true,
        preferred_username: 'allowlisted-user',
      },
      ['fictional', 'disabled', 'bearer'].join('-'),
    );

    expect(users.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'allowlisted@fictional.example', role: UserRole.ADMIN }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(membership.ensureEntitledWorkspace).not.toHaveBeenCalled();
  });
});
