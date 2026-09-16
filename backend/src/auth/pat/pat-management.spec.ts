/** Real Nest HTTP routing, real JWT verification and real controller guards.
 * No live credentials or persistent token writes: only service storage is stubbed. */
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PatManagementGuard } from '../guards/pat-management.guard';
import { AuthService } from '../auth.service';
import { PatController } from './pat.controller';
import { PatService } from './pat.service';

const secret = 'synthetic-test-secret-not-a-live-credential';
const user = { id: 'demo-user', email: 'dana@rivergreen.example', isActive: true };

describe('PAT management requires a signed-in JWT session', () => {
  let app: INestApplication;
  const service = {
    findByPlaintext: jest.fn(async (token: string) =>
      token === 'po_pat_valid_fixture'
        ? {
            user: { ...user },
            workspaceId: 'ws-one',
            token: {
              id: 'pat-fixture',
              scopes: ['read:tasks'],
              expiresAt: new Date(Date.now() + 60000),
            },
          }
        : null,
    ),
    create: jest.fn(async (_user, input) => ({ id: 'created-fixture', ...input })),
    list: jest.fn(async () => []),
    revoke: jest.fn(async () => undefined),
  };
  const session = (expiresIn = 60) => jwt.sign({ sub: user.id }, secret, { expiresIn });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [PatController],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        PatManagementGuard,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: PatService, useValue: service },
        {
          provide: AuthService,
          useValue: { validateJwtPayload: jest.fn(async () => ({ ...user })) },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => ({ JWT_SECRET: secret, BRIGADE_TRUSTED_ISSUERS: '' })[key],
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    [
      'same-workspace',
      {
        workspaceId: 'ws-one',
        scopes: ['read:tasks'],
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      },
    ],
    ['broader-scopes', { workspaceId: 'ws-one', scopes: ['write:tasks', 'write:projects'] }],
    ['different-workspace', { workspaceId: 'ws-two', scopes: ['read:tasks'] }],
    ['longer-expiry', { workspaceId: 'ws-one', expiresAt: '2099-01-01T00:00:00Z' }],
    ['no-expiry', { workspaceId: 'ws-one', expiresAt: null }],
  ])('rejects PAT mint before the service: %s', async (_label, body) => {
    await request(app.getHttpServer())
      .post('/auth/pats')
      .set('Authorization', 'Bearer po_pat_valid_fixture')
      .send({ name: 'fixture', ...body })
      .expect(403);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each(['/auth/pats', '/auth/pats/scopes'])('rejects PAT metadata endpoint %s', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer po_pat_valid_fixture')
      .expect(403);
    expect(service.list).not.toHaveBeenCalled();
  });
  it('rejects PAT revocation before the service', async () => {
    await request(app.getHttpServer())
      .delete('/auth/pats/another-token')
      .set('Authorization', 'Bearer po_pat_valid_fixture')
      .expect(403);
    expect(service.revoke).not.toHaveBeenCalled();
  });
  it('keeps browser JWT mint, metadata and revoke working', async () => {
    const token = session();
    const body = {
      name: 'fixture',
      workspaceId: 'ws-two',
      scopes: ['read:tasks'],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };
    await request(app.getHttpServer())
      .post('/auth/pats')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ id: user.id }), {
      ...body,
      expiresAt: new Date(body.expiresAt),
    });
    await request(app.getHttpServer())
      .get('/auth/pats')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/auth/pats/scopes')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete('/auth/pats/fixture')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    expect(service.revoke).toHaveBeenCalledWith(user.id, 'fixture');
  });
  it.each(['missing', 'bad-signature', 'expired', 'invalid-pat'])(
    'rejects invalid authentication: %s',
    async (kind) => {
      const req = request(app.getHttpServer()).post('/auth/pats');
      if (kind !== 'missing')
        req.set(
          'Authorization',
          'Bearer ' +
            {
              'bad-signature': jwt.sign({ sub: user.id }, 'wrong-fixture-secret'),
              expired: session(-1),
              'invalid-pat': 'po_pat_invalid_fixture',
            }[kind],
        );
      await req.send({ name: 'fixture' }).expect(401);
      expect(service.create).not.toHaveBeenCalled();
    },
  );
});
