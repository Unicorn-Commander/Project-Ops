import { spawn } from 'child_process';
import { WorkspacesController } from '../../../src/workspaces/workspaces.controller';
import { WorkspacesService } from '../../../src/workspaces/workspaces.service';
import { randomUUID, createHash } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaClient, User, UserRole, WorkspaceRole } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { UsersService } from '../../../src/users/users.service';
import { AuthController } from '../../../src/auth/auth.controller';
import { AuthService } from '../../../src/auth/auth.service';
import { JwtStrategy } from '../../../src/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../../../src/auth/guards/jwt-auth.guard';
import { PatService } from '../../../src/auth/pat/pat.service';
import { MembershipService } from '../../../src/common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../../../src/common/workspace/workspace-membership.guard';
import { WorkspaceInvitationsController } from '../../../src/workspaces/workspace-invitations.controller';
import { WorkspaceInvitationsService } from '../../../src/workspaces/workspace-invitations.service';

const adminUrl = process.env.INVITATION_ADMIN_DATABASE_URL;
const appUrl = process.env.INVITATION_APP_DATABASE_URL;
const suite = adminUrl && appUrl ? describe : describe.skip;
suite('manual workspace invitations: real HTTP guards and non-BYPASSRLS PostgreSQL', () => {
  let app: INestApplication,
    admin: PrismaClient,
    prisma: PrismaService,
    auth: AuthService,
    membership: MembershipService,
    invites: WorkspaceInvitationsService,
    config: ConfigService,
    pat: PatService;
  const mail = jest.fn(() => {
    throw new Error('No outbound email permitted');
  });
  const jwt = new JwtService({ secret: 'isolated-workspace-invite-test-only' });
  const email = () => `${randomUUID()}@workspace-invite.example`;
  const created: string[] = [];
  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: adminUrl! } } });
    await admin.$connect();
    process.env.DATABASE_URL = appUrl!;
    prisma = new PrismaService();
    await prisma.$connect();
    config = new ConfigService({
      JWT_SECRET: 'isolated-workspace-invite-test-only',
      PROJECT_OPS_TENANCY_ENABLED: 'true',
      PROJECT_OPS_ENTITLEMENTS_ENABLED: 'false',
    });
    membership = new MembershipService(prisma, config);
    auth = new AuthService(
      new UsersService(prisma),
      jwt,
      config,
      prisma,
      { sendEmail: mail } as any,
      membership,
    );
    invites = new WorkspaceInvitationsService(prisma);
    pat = new PatService(prisma, membership);
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [WorkspaceInvitationsController, AuthController, WorkspacesController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: WorkspaceMembershipGuard },
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: config },
        { provide: PatService, useValue: pat },
        { provide: MembershipService, useValue: membership },
        { provide: WorkspaceInvitationsService, useValue: invites },
        {
          provide: WorkspacesService,
          useValue: new WorkspacesService(prisma, config, membership, {} as any, {} as any),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.use((req: any, _res: any, next: any) => {
      req.url = req.url.replace(/^\/api\/v1(?=\/)/, '');
      next();
    });
    app.enableCors({ origin: process.env.INVITATION_BROWSER_URL || 'http://127.0.0.1:55488' });
    await app.init();
    const roles = await prisma.$queryRaw<
      Array<{ rolbypassrls: boolean; rolsuper: boolean }>
    >`SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user`;
    expect(roles[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
  afterAll(async () => {
    expect(mail).not.toHaveBeenCalled();
    await app?.close();
    await admin.workspace.deleteMany({ where: { id: { in: created } } });
    await admin.user.deleteMany({
      where: { email: { endsWith: '@workspace-invite.example', mode: 'insensitive' } },
    });
    await prisma.$disconnect();
    await admin.$disconnect();
  });
  async function fixture() {
    const e = email();
    const owner = await admin.user.create({
      data: {
        email: e,
        username: e,
        firstName: 'Fixture',
        lastName: 'Owner',
        keycloakId: randomUUID(),
        role: UserRole.STAFF,
      },
    });
    const ws = await admin.workspace.create({
      data: { id: randomUUID(), slug: randomUUID(), displayName: 'Isolated fixture' },
    });
    created.push(ws.id);
    await admin.membership.create({
      data: {
        userKey: owner.keycloakId!,
        workspaceId: ws.id,
        role: WorkspaceRole.OWNER,
        status: 'ACTIVE',
      },
    });
    return { owner, ws };
  }
  const token = (u: User, verified = true) =>
    jwt.sign({ sub: u.id, email: u.email, email_verified: verified });
  const post = (u: User, path: string, body: any, verified = true) =>
    request(app.getHttpServer())
      .post(path)
      .set('Authorization', 'Bearer ' + token(u, verified))
      .send(body);
  async function proposal() {
    const f = await fixture();
    const invited = email();
    const response = await post(f.owner, `/workspaces/${f.ws.id}/invitations`, {
      email: invited,
      role: 'MEMBER',
    });
    expect(response.status).toBe(201);
    return { ...f, invited, invite: response.body };
  }
  async function login(e: string) {
    return auth.validateKeycloakUser(randomUUID(), { email: e, email_verified: true });
  }
  it('owner creates a hash-only capability; verified JIT has zero memberships and explicit accept joins exactly one workspace', async () => {
    const f = await proposal();
    const stored = await admin.workspaceInvitation.findUniqueOrThrow({
      where: { id: f.invite.id },
    });
    expect(stored.tokenHash).toBe(createHash('sha256').update(f.invite.token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(f.invite.token);
    const user = await login(f.invited);
    await membership.ensureSeededMembership(user);
    expect(await membership.listActiveMemberships(user)).toEqual([]);
    const session = await auth.generateTokenForUser(user);
    expect(jwt.decode(session.access_token).email_verified).toBe(true);
    const joined = await post(user, '/workspace-invitations/accept', { token: f.invite.token });
    expect(joined.status).toBe(201);
    expect(joined.body.workspaceId).toBe(f.ws.id);
    expect((await membership.listActiveMemberships(user)).map((x) => x.workspaceId)).toEqual([
      f.ws.id,
    ]);
    expect(
      (await post(user, '/workspace-invitations/accept', { token: f.invite.token })).status,
    ).toBe(400);
  });
  it('denies unverified/mismatched/expired/revoked invitation JIT and subject rebinding', async () => {
    const f = await proposal();
    for (const flag of [false, undefined, 'true'])
      await expect(
        auth.validateKeycloakUser(randomUUID(), { email: f.invited, email_verified: flag }),
      ).rejects.toThrow();
    await expect(login(email())).rejects.toThrow();
    const user = await login(f.invited);
    await expect(login(f.invited)).rejects.toThrow('different identity');
    expect(
      (await post(user, '/workspace-invitations/accept', { token: f.invite.token }, false)).status,
    ).toBe(403);
    await admin.workspaceInvitation.update({
      where: { id: f.invite.id },
      data: { status: 'revoked' },
    });
    expect(
      (await post(user, '/workspace-invitations/accept', { token: f.invite.token })).status,
    ).toBe(400);
    const g = await proposal();
    await admin.workspaceInvitation.update({
      where: { id: g.invite.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(login(g.invited)).rejects.toThrow();
  });
  it('guards owner authority, foreign workspace, role and PAT routes without capability disclosure', async () => {
    const f = await proposal(),
      other = await fixture();
    expect(
      (await post(other.owner, `/workspaces/${f.ws.id}/invitations`, { email: email() })).status,
    ).toBe(403);
    expect(
      (await post(f.owner, `/workspaces/${f.ws.id}/invitations`, { email: email(), role: 'OWNER' }))
        .status,
    ).toBe(400);
    expect(
      (await post(other.owner, '/workspace-invitations/accept', { token: f.invite.token })).status,
    ).toBe(403);
    const p = await pat.create(f.owner, {
      name: 'isolated narrow PAT',
      scopes: ['read:projects'],
      expiresAt: new Date(Date.now() + 60000),
      workspaceId: f.ws.id,
    });
    for (const [method, path, body] of [
      ['post', `/workspaces/${f.ws.id}/invitations`, { email: email() }],
      ['get', `/workspaces/${f.ws.id}/invitations`, {}],
      ['delete', `/workspaces/${f.ws.id}/invitations/${f.invite.id}`, {}],
      ['post', '/workspace-invitations/accept', { token: f.invite.token }],
    ] as const) {
      expect(
        (
          await request(app.getHttpServer())
            [method](path)
            .set('Authorization', 'Bearer ' + p.plaintext)
            .send(body)
        ).status,
      ).toBe(403);
    }
    expect(
      (
        await request(app.getHttpServer())
          .post('/workspace-invitations/accept')
          .send({ token: f.invite.token })
      ).status,
    ).toBe(401);
    expect(
      (await admin.workspaceInvitation.findUniqueOrThrow({ where: { id: f.invite.id } })).status,
    ).toBe('pending');
  });
  it('does not bypass configured entitlements or admit federation/machine claims through pending invitations', async () => {
    const f = await proposal();
    config.set('PROJECT_OPS_ENTITLEMENTS_ENABLED', 'true');
    config.set('UC_ENTITLEMENTS_URL', 'http://127.0.0.1:1');
    try {
      await expect(login(f.invited)).rejects.toThrow();
    } finally {
      config.set('PROJECT_OPS_ENTITLEMENTS_ENABLED', 'false');
    }
    for (const patch of [
      { iss: 'https://brigade.unicorncommander.ai', aud: 'project-ops' },
      { client_id: 'project-ops' },
      { clientId: 'project-ops' },
      { act: { client_id: 'service' } },
    ])
      await expect(
        auth.validateJwtPayload({
          iss: 'https://auth.unicorncommander.ai/realms/uchub',
          sub: randomUUID(),
          email: f.invited,
          email_verified: true,
          ...patch,
        }),
      ).rejects.toThrow();
  });
  it('serializes concurrent redemption, preserves member roles, and refuses suspended membership/workspace', async () => {
    const f = await proposal();
    const user = await login(f.invited);
    const responses = await Promise.all([
      post(user, '/workspace-invitations/accept', { token: f.invite.token }),
      post(user, '/workspace-invitations/accept', { token: f.invite.token }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 400]);
    const g = await proposal();
    const member = await login(g.invited);
    await admin.membership.create({
      data: {
        userKey: member.keycloakId!,
        workspaceId: g.ws.id,
        role: 'VIEWER',
        status: 'SUSPENDED',
      },
    });
    expect(
      (await post(member, '/workspace-invitations/accept', { token: g.invite.token })).status,
    ).toBe(403);
    const existing = await proposal();
    const active = await login(existing.invited);
    await admin.membership.create({
      data: {
        userKey: active.keycloakId!,
        workspaceId: existing.ws.id,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });
    const preserved = await post(active, '/workspace-invitations/accept', {
      token: existing.invite.token,
    });
    expect(preserved.status).toBe(201);
    expect(preserved.body.role).toBe('VIEWER');
    const h = await proposal();
    const invited = await login(h.invited);
    await admin.workspace.update({ where: { id: h.ws.id }, data: { status: 'archived' } });
    expect(
      (await post(invited, '/workspace-invitations/accept', { token: h.invite.token })).status,
    ).toBe(403);
    expect(await membership.listActiveMemberships(invited)).toEqual([]);
  });
  it('rejects machine session markers and preserves a single identity binding under concurrency', async () => {
    const f = await proposal();
    for (const patch of [
      { act: { client_id: 'service' } },
      { clientId: 'service' },
      { client_id: 'service' },
      { preferred_username: 'service-account-fixture' },
    ]) {
      const credential = jwt.sign({
        sub: f.owner.id,
        email: f.owner.email,
        email_verified: true,
        ...patch,
      });
      expect(
        (
          await request(app.getHttpServer())
            .get(`/workspaces/${f.ws.id}/invitations`)
            .set('Authorization', 'Bearer ' + credential)
        ).status,
      ).toBe(403);
    }
    const mixed = await fixture();
    await admin.user.update({
      where: { id: mixed.owner.id },
      data: { email: mixed.owner.email.toUpperCase() },
    });
    await expect(
      auth.validateKeycloakUser(randomUUID(), {
        email: mixed.owner.email.toLowerCase(),
        email_verified: true,
      }),
    ).rejects.toThrow('different identity');
    const e = email();
    const unbound = await admin.user.create({
      data: { email: e, username: e, firstName: 'Unbound', lastName: 'Fixture', role: 'STAFF' },
    });
    const subjects = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(
      subjects.map((sub) => auth.validateKeycloakUser(sub, { email: e, email_verified: true })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.findIndex((r) => r.status === 'fulfilled');
    expect((await admin.user.findUniqueOrThrow({ where: { id: unbound.id } })).keycloakId).toBe(
      subjects[winner],
    );
    const user = await login(f.invited);
    expect(
      (
        await request(app.getHttpServer())
          .get('/auth/profile')
          .set('Authorization', 'Bearer ' + token(user))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/workspaces/${f.ws.id}/invitations`)
          .set('Authorization', 'Bearer ' + token(user))
      ).status,
    ).toBe(403);
  });
  it('waits for membership revocation and rechecks expiry after a workspace lock wait', async () => {
    const f = await proposal();
    const user = await login(f.invited);
    await admin.membership.create({
      data: { userKey: user.keycloakId!, workspaceId: f.ws.id, role: 'VIEWER', status: 'ACTIVE' },
    });
    let started!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => (started = resolve));
    const unlock = new Promise<void>((resolve) => (release = resolve));
    const blocker = admin.$transaction(async (tx) => {
      await tx.membership.update({
        where: { userKey_workspaceId: { userKey: user.keycloakId!, workspaceId: f.ws.id } },
        data: { status: 'SUSPENDED' },
      });
      started();
      await unlock;
    });
    await locked;
    const redemption = post(user, '/workspace-invitations/accept', { token: f.invite.token }).then(
      (r) => r,
    );
    await new Promise((r) => setTimeout(r, 150));
    release();
    await blocker;
    expect((await redemption).status).toBe(403);
    expect(
      (await admin.workspaceInvitation.findUniqueOrThrow({ where: { id: f.invite.id } })).status,
    ).toBe('pending');
    const g = await proposal();
    const other = await login(g.invited);
    await admin.workspaceInvitation.update({
      where: { id: g.invite.id },
      data: { expiresAt: new Date(Date.now() + 500) },
    });
    let locked2!: () => void;
    let release2!: () => void;
    const ready2 = new Promise<void>((resolve) => (locked2 = resolve));
    const unlock2 = new Promise<void>((resolve) => (release2 = resolve));
    const blocker2 = admin.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${g.ws.id} FOR UPDATE`;
      locked2();
      await unlock2;
    });
    await ready2;
    const expired = post(other, '/workspace-invitations/accept', { token: g.invite.token }).then(
      (r) => r,
    );
    await new Promise((r) => setTimeout(r, 700));
    release2();
    await blocker2;
    expect((await expired).status).toBe(400);
    expect(await membership.listActiveMemberships(other)).toEqual([]);
  });
  it('rolls membership back if token consumption fails; revoke is exact-workspace and removes admission', async () => {
    const f = await proposal();
    const user = await login(f.invited);
    await admin.$executeRawUnsafe(
      `CREATE FUNCTION invite_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.invite.id}' AND NEW.status='accepted' THEN RAISE EXCEPTION 'isolated failure'; END IF; RETURN NEW; END $$`,
    );
    await admin.$executeRawUnsafe(
      'CREATE TRIGGER invite_test_failure BEFORE UPDATE ON workspace_invitations FOR EACH ROW EXECUTE FUNCTION invite_test_failure()',
    );
    try {
      expect(
        (await post(user, '/workspace-invitations/accept', { token: f.invite.token })).status,
      ).toBe(500);
      expect(await membership.listActiveMemberships(user)).toEqual([]);
      expect(
        (await admin.workspaceInvitation.findUniqueOrThrow({ where: { id: f.invite.id } })).status,
      ).toBe('pending');
    } finally {
      await admin.$executeRawUnsafe('DROP TRIGGER invite_test_failure ON workspace_invitations');
      await admin.$executeRawUnsafe('DROP FUNCTION invite_test_failure()');
    }
    const g = await proposal();
    const response = await request(app.getHttpServer())
      .delete(`/workspaces/${g.ws.id}/invitations/${g.invite.id}`)
      .set('Authorization', 'Bearer ' + token(g.owner));
    expect(response.status).toBe(200);
    await expect(login(g.invited)).rejects.toThrow();
  });
  (process.env.INVITATION_BROWSER_URL ? it : it.skip)(
    'actual owner and invitee browser UI uses body-only capability and real guarded routes',
    async () => {
      await app.listen(55487, '127.0.0.1');
      const f = await fixture();
      const e = email();
      const invitee = await admin.user.create({
        data: {
          email: e,
          username: e,
          firstName: 'Invited',
          lastName: 'Fixture',
          keycloakId: randomUUID(),
          role: 'STAFF',
        },
      });
      try {
        const result = await new Promise<number>((resolve, reject) => {
          const child = spawn('python3', ['tests/integration/invitations/browser-proof.py'], {
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let output = '';
          child.stdout.on('data', (d) => (output += d));
          child.stderr.on('data', (d) => (output += d));
          child.on('error', reject);
          child.on('exit', (code) => {
            if (code !== 0) reject(new Error(output));
            else resolve(code!);
          });
          child.stdin.end(
            JSON.stringify({
              url: process.env.INVITATION_BROWSER_URL,
              owner: token(f.owner),
              invitee: token(invitee),
              email: e,
            }),
          );
        });
        expect(result).toBe(0);
        expect((await membership.listActiveMemberships(invitee)).map((x) => x.workspaceId)).toEqual(
          [f.ws.id],
        );
      } finally {
        await app.close();
      }
    },
    90000,
  );
});
