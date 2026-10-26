import { All, Controller, INestApplication, Req, UseGuards } from '@nestjs/common';
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
import { PatService } from '../pat/pat.service';
import { McpController } from '../../mcp/mcp.controller';
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

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [],
      controllers: [OAuthDiscoveryController, McpProbeController],
      providers: [
        OAuthDiscoveryService,
        JwtStrategy,
        JwtAuthGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: ConfigService, useValue: config },
        { provide: PatService, useValue: patService },
        { provide: AuthService, useValue: { validateJwtPayload: jest.fn() } },
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
  });

  it('serves both RFC 9728 metadata paths without auth and with cache/CORS headers', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/api/v1/mcp',
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['access-control-allow-origin']).toBe('*');
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
    expect(JSON.stringify(response.body)).not.toContain('po_pat_');
  });

  it('returns invalid_token discovery for an unknown PAT', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/mcp')
      .set('Authorization', 'Bearer po_pat_synthetic_invalid')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
      .expect(401);

    expect(response.headers['www-authenticate']).toContain('error="invalid_token"');
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
