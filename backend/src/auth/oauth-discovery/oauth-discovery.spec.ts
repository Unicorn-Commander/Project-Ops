import {
  All,
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'crypto';
import { UserRole } from '@prisma/client';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { AuthService } from '../auth.service';
import { NoWorkspaceAccessException } from '../no-workspace-access.exception';
import { __resetAccessListCacheForTests } from '../access-list';
import { PatService } from '../pat/pat.service';
import { McpController } from '../../mcp/mcp.controller';
import { WorkspaceMembershipGuard } from '../../common/workspace/workspace-membership.guard';
import { MembershipService } from '../../common/workspace/membership.service';
import { createMcpCorsMiddleware } from './mcp-cors';
import { OAuthDiscoveryController } from './oauth-discovery.controller';
import { OAuthDiscoveryService } from './oauth-discovery.service';

let jwksPublicKey = '';

jest.mock('jwks-rsa', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    getSigningKey: (_kid: string, callback: (error: Error | null, key?: any) => void) =>
      callback(null, { getPublicKey: () => jwksPublicKey }),
  })),
}));

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
jwksPublicKey = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const localSecret = 'synthetic-local-secret-for-oauth-tests';
const realmIssuer = 'https://auth.example.com/realms/uchub';

@Controller('mcp')
class McpProbeController {
  @All()
  @UseGuards(JwtAuthGuard)
  handle(@Req() request: any) {
    return { ok: Boolean(request.user) };
  }
}

/** A protected REST route. Same guards as MCP, no discovery challenge of its own. */
@Controller('rest-probe')
class RestProbeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  handle(@Req() request: any) {
    return { ok: Boolean(request.user) };
  }
}

const NO_PROJECT_OPS_ACCESS_MESSAGE =
  'You are signed in but have no Project-Ops access. Contact your administrator.';
const INSUFFICIENT_SCOPE_HEADER =
  'Bearer realm="project-ops-mcp", error="insufficient_scope", ' +
  `error_description="${NO_PROJECT_OPS_ACCESS_MESSAGE}"`;

function signValidRealmToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: realmIssuer,
      azp: 'project-ops',
      aud: 'account',
      sid: 'fictional-session',
      email_verified: true,
      iat: now - 10,
      exp: now + 300,
      ...claims,
    },
    keyPair.privateKey,
    { algorithm: 'RS256', keyid: 'canary-jwks-key' },
  );
}

function expectNoProjectOpsAccess(response: { status: number; headers: any; body: any }) {
  expect(response.status).toBe(403);
  expect(response.headers['www-authenticate']).toBe(INSUFFICIENT_SCOPE_HEADER);
  expect(response.headers['www-authenticate']).not.toContain('invalid_token');
  expect(response.headers['www-authenticate']).not.toContain('resource_metadata');
  expect(response.body).toEqual({
    error: 'no_workspace_access',
    message: NO_PROJECT_OPS_ACCESS_MESSAGE,
  });
}

describe('Project Ops MCP OAuth discovery and resource-server boundary', () => {
  let app: INestApplication;
  const configValues: Record<string, string | undefined> = {
    JWT_SECRET: localSecret,
    BRIGADE_TRUSTED_ISSUERS: '',
    KEYCLOAK_URL: 'https://auth.example.com',
    KEYCLOAK_REALM: 'uchub',
    KEYCLOAK_CLIENT_ID: 'project-ops',
    CORS_ORIGIN: 'https://portal.example.com',
    FRONTEND_URL: 'https://portal.example.com',
    MCP_CORS_ORIGINS: 'https://allowed.example.com',
  };
  const config = {
    get: <T>(key: string, fallback?: T) => (configValues[key] ?? fallback) as T,
  } as unknown as ConfigService;
  const patService = {
    findByPlaintext: jest.fn(async () => null),
  } as unknown as PatService;
  const validateJwtPayload = jest.fn();
  const resolveAndAuthorize = jest.fn();
  const assertCanWrite = jest.fn();
  const verifiedUser = {
    id: 'synthetic-user',
    email: 'member@example.com',
    username: 'synthetic-member',
    role: UserRole.STAFF,
    isActive: true,
  } as any;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [],
      controllers: [OAuthDiscoveryController, McpProbeController, RestProbeController],
      providers: [
        OAuthDiscoveryService,
        JwtStrategy,
        JwtAuthGuard,
        WorkspaceMembershipGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: WorkspaceMembershipGuard },
        { provide: ConfigService, useValue: config },
        { provide: PatService, useValue: patService },
        { provide: AuthService, useValue: { validateJwtPayload } },
        {
          provide: MembershipService,
          useValue: { resolveAndAuthorize, assertCanWrite },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.use(createMcpCorsMiddleware(config));
    app.enableCors({ origin: 'https://portal.example.com', credentials: true });
    app.setGlobalPrefix('api/v1', {
      exclude: [
        '.well-known/oauth-protected-resource',
        '.well-known/oauth-protected-resource/api/v1/mcp',
      ],
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    validateJwtPayload.mockResolvedValue(verifiedUser);
    resolveAndAuthorize.mockResolvedValue('workspace-synthetic');
    assertCanWrite.mockResolvedValue(undefined);
  });

  it('serves both RFC 9728 metadata paths without auth and with cache/CORS headers', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/v1/mcp',
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
      expect(Object.keys(response.body)).toEqual(
        expect.arrayContaining([
          'resource',
          'authorization_servers',
          'bearer_methods_supported',
          'scopes_supported',
          'resource_name',
          'resource_documentation',
        ]),
      );
      expect(response.body.resource).toMatch(/\/api\/v1\/mcp$/);
      // Clients request exactly these; Keycloak's DCR policy refuses any other scope, and `mcp` carries the audience.
      expect(response.body.scopes_supported).toEqual([
        'openid',
        'profile',
        'email',
        'offline_access',
        'mcp',
      ]);
    }
  });

  it('serves OPTIONS for both RFC 9728 metadata paths without auth', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/v1/mcp',
    ]) {
      const response = await request(app.getHttpServer())
        .options(path)
        .set('Origin', 'https://outside.example.com')
        .expect(204);
      expect(response.headers['access-control-allow-origin']).toBe('*');
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
    }
  });

  it('answers MCP preflight before auth and carries the Streamable HTTP header contract', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/v1/mcp')
      .set('Origin', 'https://allowed.example.com')
      .set('Access-Control-Request-Headers', 'Authorization, Mcp-Session-Id')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBe('https://allowed.example.com');
    expect(response.headers['access-control-allow-headers']).toContain('Authorization');
    expect(response.headers['access-control-allow-headers']).toContain('Mcp-Session-Id');
    expect(response.headers['access-control-allow-headers']).toContain('Mcp-Protocol-Version');
    expect(response.headers['access-control-allow-headers']).toContain('Last-Event-ID');
    expect(response.headers['access-control-expose-headers']).toBe('Mcp-Session-Id');
  });

  it('rejects an MCP browser request from a disallowed origin before auth', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Origin', 'https://outside.example.com')
      .set('Authorization', 'Bearer po_pat_synthetic_invalid')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(403);

    expect(response.body).toEqual({ error: 'origin_not_allowed' });
    expect(response.headers['www-authenticate']).toBeUndefined();
  });

  it('returns the discovery challenge for a missing bearer', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(response.headers['www-authenticate']).toMatch(
      /^Bearer realm="project-ops-mcp", resource_metadata="http:\/\/[^\"]+\/.well-known\/oauth-protected-resource\/api\/v1\/mcp"$/,
    );
    expect(response.headers['www-authenticate']).not.toContain('invalid_token');
    expect(response.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
    expect(JSON.stringify(response.body)).not.toContain('po_pat_');
  });

  it('returns invalid_token discovery for an unknown PAT', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', 'Bearer po_pat_synthetic_invalid')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(response.body).toEqual({
      statusCode: 401,
      message: 'Invalid token',
      error: 'Unauthorized',
    });
    expect(patService.findByPlaintext).toHaveBeenCalledWith('po_pat_synthetic_invalid');
    expect(JSON.stringify(response.body)).not.toContain('po_pat_synthetic_invalid');
  });

  it('returns invalid_token discovery for an expired session JWT', async () => {
    const token = jwt.sign({ sub: 'synthetic-user' }, localSecret, { expiresIn: -1 });
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(response.body).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
    });
  });

  it('returns insufficient_scope for a verified token rejected before workspace provisioning', async () => {
    const token = jwt.sign(
      { sub: 'synthetic-unprovisioned', email: 'unprovisioned@example.com' },
      localSecret,
      { expiresIn: 300 },
    );
    validateJwtPayload.mockRejectedValueOnce(new NoWorkspaceAccessException());

    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(403);

    expectNoProjectOpsAccess(response);
    expect(resolveAndAuthorize).not.toHaveBeenCalled();
  });

  it('returns insufficient_scope for a verified token whose user has no active membership', async () => {
    const token = jwt.sign(
      { sub: 'synthetic-unprovisioned', email: 'unprovisioned@example.com' },
      localSecret,
      { expiresIn: 300 },
    );
    resolveAndAuthorize.mockRejectedValueOnce(
      new ForbiddenException('No workspace access for this user.'),
    );

    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(403);

    expectNoProjectOpsAccess(response);
  });

  function deniedAuthService() {
    const users = {
      findByKeycloakId: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    const prisma = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      workspaceInvitation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const membership = { ensureEntitledWorkspace: jest.fn() };
    const auth = new AuthService(
      users as any,
      {} as any,
      config,
      prisma as any,
      {} as any,
      membership as any,
    );
    return { auth, users, membership };
  }

  async function bothSurfaces(token: string) {
    const mcp = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const rest = await request(app.getHttpServer())
      .get('/api/v1/rest-probe')
      .set('Authorization', `Bearer ${token}`);
    return { mcp, rest };
  }

  it('keeps a missing bearer and a rejected token on 401 with the MCP resource_metadata link', async () => {
    const missingMcp = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(missingMcp.status).toBe(401);
    expect(missingMcp.headers['www-authenticate']).toMatch(
      /^Bearer realm="project-ops-mcp", resource_metadata="http:\/\/[^"]+\/.well-known\/oauth-protected-resource\/api\/v1\/mcp"$/,
    );
    expect(missingMcp.headers['www-authenticate']).not.toContain('invalid_token');
    expect(missingMcp.headers['www-authenticate']).not.toContain('insufficient_scope');

    const expired = jwt.sign({ sub: 'synthetic-user' }, localSecret, { expiresIn: -1 });
    const rejectedMcp = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${expired}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(rejectedMcp.status).toBe(401);
    expect(rejectedMcp.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(rejectedMcp.headers['www-authenticate']).toContain('resource_metadata="http://');
    expect(rejectedMcp.headers['www-authenticate']).toContain(
      '/.well-known/oauth-protected-resource/api/v1/mcp"',
    );
    expect(rejectedMcp.headers['www-authenticate']).not.toContain('insufficient_scope');

    // REST 401s do not carry the MCP discovery challenge. That link stays on /api/v1/mcp only.
    const missingRest = await request(app.getHttpServer()).get('/api/v1/rest-probe');
    expect(missingRest.status).toBe(401);
    expect(missingRest.headers['www-authenticate']).toBeUndefined();

    const rejectedRest = await request(app.getHttpServer())
      .get('/api/v1/rest-probe')
      .set('Authorization', `Bearer ${expired}`);
    expect(rejectedRest.status).toBe(401);
    expect(rejectedRest.headers['www-authenticate']).toBeUndefined();
    expect(rejectedRest.body.statusCode).toBe(401);
  });

  it('returns 403 insufficient_scope on REST and MCP when a valid token is not on the access list', async () => {
    const originalAccessList = process.env.PROJECT_OPS_ACCESS_LIST;
    const previousEntitlements = configValues.PROJECT_OPS_ENTITLEMENTS_ENABLED;
    const previousTenancy = configValues.PROJECT_OPS_TENANCY_ENABLED;
    process.env.PROJECT_OPS_ACCESS_LIST = 'allowlisted@fictional.example:ADMIN';
    configValues.PROJECT_OPS_ENTITLEMENTS_ENABLED = 'false';
    configValues.PROJECT_OPS_TENANCY_ENABLED = 'false';
    __resetAccessListCacheForTests();
    const warnings: string[] = [];
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    const { auth, users, membership } = deniedAuthService();
    validateJwtPayload.mockImplementation((payload: any, accessToken?: string) =>
      auth.validateJwtPayload(payload, accessToken),
    );
    const token = signValidRealmToken({
      sub: 'fictional-unprovisioned-sub',
      email: 'stranger@fictional.example',
      preferred_username: 'fictional-stranger',
    });

    try {
      const { mcp, rest } = await bothSurfaces(token);
      expectNoProjectOpsAccess(mcp);
      expectNoProjectOpsAccess(rest);
      expect(users.create).not.toHaveBeenCalled();
      expect(users.findByKeycloakId).toHaveBeenCalledWith('fictional-unprovisioned-sub');
      expect(membership.ensureEntitledWorkspace).not.toHaveBeenCalled();
      expect(
        warnings.some((line) => line.includes('Rejected SSO JIT for stranger@fictional.example')),
      ).toBe(true);
    } finally {
      warnSpy.mockRestore();
      if (originalAccessList === undefined) delete process.env.PROJECT_OPS_ACCESS_LIST;
      else process.env.PROJECT_OPS_ACCESS_LIST = originalAccessList;
      if (previousEntitlements === undefined) delete configValues.PROJECT_OPS_ENTITLEMENTS_ENABLED;
      else configValues.PROJECT_OPS_ENTITLEMENTS_ENABLED = previousEntitlements;
      if (previousTenancy === undefined) delete configValues.PROJECT_OPS_TENANCY_ENABLED;
      else configValues.PROJECT_OPS_TENANCY_ENABLED = previousTenancy;
      __resetAccessListCacheForTests();
    }
  });

  it('returns 403 insufficient_scope on REST and MCP when a valid token has no entitled org', async () => {
    const entitlementKeys = [
      'PROJECT_OPS_ENTITLEMENTS_ENABLED',
      'UC_ENTITLEMENTS_URL',
      'PROJECT_OPS_TENANCY_ENABLED',
      'PROJECT_OPS_ENTITLEMENTS_FAIL_OPEN',
      'PROJECT_OPS_ENTITLEMENTS_ALLOWLIST_FALLBACK',
    ];
    const previousConfig = entitlementKeys.map((key) => [key, configValues[key]] as const);
    Object.assign(configValues, {
      PROJECT_OPS_ENTITLEMENTS_ENABLED: 'true',
      UC_ENTITLEMENTS_URL: 'https://ops.fictional.example/api/v1/entitlements',
      PROJECT_OPS_TENANCY_ENABLED: 'false',
      PROJECT_OPS_ENTITLEMENTS_FAIL_OPEN: 'false',
      PROJECT_OPS_ENTITLEMENTS_ALLOWLIST_FALLBACK: 'false',
    });
    const warnings: string[] = [];
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation((message: unknown) => {
      warnings.push(String(message));
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        org_id: '01924a3c-0000-7000-8000-000000000123',
        org_name: 'Fictional Side Studio',
        tier: 'free',
        role: 'member',
        entitlements: ['contact_ops_access'],
      }),
    } as Response);
    const { auth, users, membership } = deniedAuthService();
    validateJwtPayload.mockImplementation((payload: any, accessToken?: string) =>
      auth.validateJwtPayload(payload, accessToken),
    );
    const token = signValidRealmToken({
      sub: 'fictional-unentitled-sub',
      email: 'member@fictional.example',
      preferred_username: 'fictional-member',
    });

    try {
      const { mcp, rest } = await bothSurfaces(token);
      expectNoProjectOpsAccess(mcp);
      expectNoProjectOpsAccess(rest);
      expect(users.create).not.toHaveBeenCalled();
      expect(users.findByKeycloakId).not.toHaveBeenCalled();
      expect(membership.ensureEntitledWorkspace).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalled();
      expect(
        warnings.some((line) => line.includes('Rejected SSO for member@fictional.example')),
      ).toBe(true);
    } finally {
      fetchMock.mockRestore();
      warnSpy.mockRestore();
      for (const [key, value] of previousConfig) {
        if (value === undefined) delete configValues[key];
        else configValues[key] = value;
      }
    }
  });

  it('returns 200 for a verified token with an active membership', async () => {
    const token = jwt.sign({ sub: 'synthetic-member', email: 'member@example.com' }, localSecret, {
      expiresIn: 300,
    });

    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(200);

    expect(response.body).toEqual({ ok: true });
    expect(resolveAndAuthorize).toHaveBeenCalledWith(verifiedUser, null);
    expect(validateJwtPayload).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 'synthetic-member' }),
      token,
    );
  });

  it('returns 200 on the first entitled bearer call after provisioning its org workspace', async () => {
    const entitlementKeys = [
      'PROJECT_OPS_ENTITLEMENTS_ENABLED',
      'UC_ENTITLEMENTS_URL',
      'PROJECT_OPS_TENANCY_ENABLED',
    ];
    const previousConfig = entitlementKeys.map((key) => [key, configValues[key]] as const);
    Object.assign(configValues, {
      PROJECT_OPS_ENTITLEMENTS_ENABLED: 'true',
      UC_ENTITLEMENTS_URL: 'https://ops.fictional.example/api/v1/entitlements',
      PROJECT_OPS_TENANCY_ENABLED: 'true',
    });

    const firstLoginUser = {
      id: 'fictional-entitled-user',
      email: 'owner@fictional.example',
      username: 'fictional-owner',
      firstName: 'Fictional',
      lastName: 'Owner',
      keycloakId: 'fictional-keycloak-sub',
      role: UserRole.STAFF,
      isActive: true,
    } as any;
    const users = {
      findByKeycloakId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(firstLoginUser),
    };
    const membership = {
      ensureEntitledWorkspace: jest.fn().mockResolvedValue('01924a3c-0000-7000-8000-000000000123'),
    };
    const actualAuth = new AuthService(
      users as any,
      {} as any,
      config,
      { user: { findMany: jest.fn().mockResolvedValue([]) } } as any,
      {} as any,
      membership as any,
    );
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        org_id: '01924a3c-0000-7000-8000-000000000123',
        org_name: 'Fictional Acme Studio',
        tier: 'byok',
        role: 'member',
        entitlements: ['project_ops_access'],
      }),
    } as Response);
    validateJwtPayload.mockImplementation((payload: any, accessToken?: string) =>
      actualAuth.validateJwtPayload(payload, accessToken),
    );

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: 'fictional-keycloak-sub',
        email: 'owner@fictional.example',
        email_verified: true,
        preferred_username: 'fictional-owner',
        iss: realmIssuer,
        azp: 'project-ops',
        aud: 'account',
        sid: 'fictional-session',
        iat: now - 10,
        exp: now + 300,
      },
      keyPair.privateKey,
      { algorithm: 'RS256', keyid: 'canary-jwks-key' },
    );

    try {
      const response = await request(app.getHttpServer())
        .post('/api/v1/mcp')
        .set('Authorization', `Bearer ${token}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
        .expect(200);

      expect(response.body).toEqual({ ok: true });
      expect(membership.ensureEntitledWorkspace).toHaveBeenCalledWith(
        firstLoginUser,
        '01924a3c-0000-7000-8000-000000000123',
        UserRole.STAFF,
        'Fictional Acme Studio',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
        }),
      );
    } finally {
      fetchMock.mockRestore();
      for (const [key, value] of previousConfig) {
        if (value === undefined) delete configValues[key];
        else configValues[key] = value;
      }
    }
  });

  it('returns invalid_token discovery for an expired signed Keycloak token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: 'synthetic-user',
        iss: realmIssuer,
        azp: 'project-ops',
        aud: 'account',
        iat: now - 600,
        exp: now - 300,
      },
      keyPair.privateKey,
      { algorithm: 'RS256', keyid: 'canary-jwks-key' },
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(response.body).toEqual({ statusCode: 401, message: 'Unauthorized' });
  });

  it('returns invalid_token discovery for a signed Keycloak token with the wrong audience', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      {
        sub: 'synthetic-user',
        iss: realmIssuer,
        azp: 'sibling-app',
        aud: 'account',
        iat: now - 10,
        exp: now + 300,
      },
      keyPair.privateKey,
      { algorithm: 'RS256', keyid: 'canary-jwks-key' },
    );
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', `Bearer ${token}`)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
    expect(response.body).toEqual({
      statusCode: 401,
      message: 'Token is not authorized for project-ops',
      error: 'Unauthorized',
    });
  });

  it('does not use a browser cookie/session to authenticate the MCP path', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Cookie', 'access_token=synthetic-cookie-value')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(response.headers['www-authenticate']).not.toContain('error="invalid_token"');
  });

  it('does not add a discovery challenge to an authenticated CLIENT 403', async () => {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const controller = new McpController({} as any, {} as any);
    await controller.handle({ user: { role: UserRole.CLIENT } } as any, response);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: 'client_portal_required' });
    expect(response.setHeader).toBeUndefined();
  });

  it('uses configured public origin and ring-specific Keycloak issuer in metadata', () => {
    const dogfoodConfig = {
      get: <T>(key: string, fallback?: T) =>
        (({
          PUBLIC_API_BASE_URL: 'https://api.projectops.magicunicorn.dev',
          KEYCLOAK_URL: 'https://auth.magicunicorn.dev',
          KEYCLOAK_REALM: 'uchub',
        })[key] ?? fallback) as T,
    } as unknown as ConfigService;
    const service = new OAuthDiscoveryService(dogfoodConfig);
    const metadata = service.getMetadata({
      headers: { host: 'internal:3000' },
      protocol: 'http',
      get: () => 'internal:3000',
    } as any);

    expect(metadata.resource).toBe('https://api.projectops.magicunicorn.dev/api/v1/mcp');
    expect(metadata.authorization_servers).toEqual(['https://auth.magicunicorn.dev/realms/uchub']);
  });

  it('falls back to forwarded public proto/host when the public URL is unset', () => {
    const service = new OAuthDiscoveryService(config);
    const metadata = service.getMetadata({
      headers: {
        host: 'internal:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'api.projectops.example.com',
      },
      protocol: 'http',
      get: () => 'internal:3000',
    } as any);

    expect(metadata.resource).toBe('https://api.projectops.example.com/api/v1/mcp');
  });
});
