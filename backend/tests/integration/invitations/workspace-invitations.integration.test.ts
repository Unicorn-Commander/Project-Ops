import { TimesheetService } from '../../../src/time-tracking/timesheet.service';
import { TriageController } from '../../../src/triage/triage.controller';
import { TriageService } from '../../../src/triage/triage.service';
import { ClientPortalController } from '../../../src/client-portal/client-portal.controller';
import { ApprovalsService } from '../../../src/client-portal/approvals/approvals.service';
import { PatController } from '../../../src/auth/pat/pat.controller';
import { io, Socket as ClientSocket } from 'socket.io-client';
import { RealtimeGateway } from '../../../src/websocket/realtime.gateway';
import { ClientPortalService } from '../../../src/client-portal/client-portal.service';
import { WorkspaceContextService } from '../../../src/common/workspace/workspace-context.service';
import { ProjectsController } from '../../../src/projects/projects.controller';
import { ProjectsService } from '../../../src/projects/projects.service';
import { TasksController } from '../../../src/tasks/tasks.controller';
import { TasksService } from '../../../src/tasks/tasks.service';
import { TimeEntriesController } from '../../../src/time-tracking/time-entries.controller';
import { TimeEntryService } from '../../../src/time-tracking/time-entry.service';
import { TimerService } from '../../../src/time-tracking/timer.service';
import { McpController } from '../../../src/mcp/mcp.controller';
import { McpService } from '../../../src/mcp/mcp.service';
import { spawn } from 'child_process';
import { WorkspacesController } from '../../../src/workspaces/workspaces.controller';
import { WorkspacesService } from '../../../src/workspaces/workspaces.service';
import { randomUUID, createHash, generateKeyPairSync } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
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
    pat: PatService,
    workspace: WorkspaceContextService,
    mcp: McpService;
  const mail = jest.fn(() => {
    throw new Error('No outbound email permitted');
  });
  const jwt = new JwtService({ secret: 'isolated-workspace-invite-test-only' });
  let jwksServer: Server, realmIssuer: string, brigadeIssuer: string, privateKey: string;
  const previousBrigadeIssuers = process.env.BRIGADE_TRUSTED_ISSUERS;
  const signMachine = (claims: Record<string, unknown>) =>
    new JwtService().sign(claims, { privateKey, algorithm: 'RS256', keyid: 'fixture-only', expiresIn: '1h' });
  const email = () => `${randomUUID()}@workspace-invite.example`;
  const created: string[] = [];
  beforeAll(async () => {
    // Isolated JWKS exercises real signature validation; no live issuer/secret
    // and no AuthService identity mock on the federation path.
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture-only', alg: 'RS256', use: 'sig' };
    jwksServer = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
    const issuerBase = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}`;
    realmIssuer = `${issuerBase}/realms/uchub`;
    brigadeIssuer = `${issuerBase}/brigade`;
    process.env.BRIGADE_TRUSTED_ISSUERS = brigadeIssuer;
    admin = new PrismaClient({ datasources: { db: { url: adminUrl! } } });
    await admin.$connect();
    process.env.DATABASE_URL = appUrl!;
    prisma = new PrismaService();
    await prisma.$connect();
    config = new ConfigService({
      JWT_SECRET: 'isolated-workspace-invite-test-only',
      KEYCLOAK_URL: issuerBase,
      KEYCLOAK_REALM: 'uchub',
      BRIGADE_TRUSTED_ISSUERS: brigadeIssuer,
      PROJECT_OPS_FEDERATION_ACTORS: 'meeting-ops',
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
    workspace = new WorkspaceContextService(config, prisma, membership);
    const events = { emit: jest.fn() } as any;
    const projects = new ProjectsService(
      prisma,
      { log: jest.fn() } as any,
      workspace,
      events,
      undefined,
      membership,
    );
    const tasks = new TasksService(prisma, workspace, { sendEmail: mail } as any, config, events);
    const unused = {} as any;
    mcp = new McpService(
      prisma,
      unused,
      unused,
      workspace,
      unused,
      unused,
      unused,
      unused,
      unused,
      events,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        WorkspaceInvitationsController,
        AuthController,
        WorkspacesController,
        ProjectsController,
        TasksController,
        TimeEntriesController,
        McpController,
        TriageController,
        ClientPortalController,
        PatController,
      ],
      providers: [
        JwtStrategy,
        { provide: ApprovalsService, useValue: {} },
        RealtimeGateway,
        { provide: JwtService, useValue: jwt },
        { provide: WorkspaceContextService, useValue: workspace },
        {
          provide: ClientPortalService,
          useValue: new ClientPortalService(
            workspace,
            { log: jest.fn() } as any,
            events,
            {} as any,
          ),
        },
        { provide: ProjectsService, useValue: projects },
        {
          provide: TriageService,
          useValue: new TriageService(config, prisma, workspace, projects, tasks),
        },
        { provide: TasksService, useValue: tasks },
        { provide: TimerService, useValue: unused },
        { provide: TimeEntryService, useValue: unused },
        { provide: McpService, useValue: mcp },
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
    if (previousBrigadeIssuers === undefined) delete process.env.BRIGADE_TRUSTED_ISSUERS;
    else process.env.BRIGADE_TRUSTED_ISSUERS = previousBrigadeIssuers;
    await new Promise<void>((resolve, reject) => jwksServer?.close((error) => error ? reject(error) : resolve()));
    expect(mail).not.toHaveBeenCalled();
    await app?.close();
    await admin.comment.deleteMany({ where: { workspaceId: { in: created } } });
    await admin.timeEntry.deleteMany({ where: { workspaceId: { in: created } } });
    await admin.task.deleteMany({ where: { workspaceId: { in: created } } });
    await admin.project.deleteMany({ where: { workspaceId: { in: created } } });
    await admin.contact.deleteMany({ where: { workspaceId: { in: created } } });
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
    jwt.sign({ sub: u.id, email: u.email, email_verified: verified }, { expiresIn: '1h' });
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
  it('workspace managers list and count their workspace without an app-wide role promotion', async () => {
    const f = await fixture();
    const other = await fixture();
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'MANAGER' },
    });
    await admin.membership.create({
      data: {
        userKey: f.owner.keycloakId!,
        workspaceId: other.ws.id,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });
    await admin.project.createMany({
      data: [
        {
          title: 'Managed unassigned', clientName: 'Synthetic fixture',
          projectNumber: randomUUID(),
          workspaceId: f.ws.id,
          createdById: other.owner.id,
        },
        {
          title: 'Other unassigned', clientName: 'Synthetic fixture',
          projectNumber: randomUUID(),
          workspaceId: other.ws.id,
          createdById: other.owner.id,
        },
        {
          title: 'Other assigned', clientName: 'Synthetic fixture',
          projectNumber: randomUUID(),
          workspaceId: other.ws.id,
          createdById: other.owner.id,
          assignedToId: f.owner.id,
        },
      ],
    });
    const get = (path: string, ws: string) =>
      request(app.getHttpServer())
        .get(path)
        .set('Authorization', 'Bearer ' + token(f.owner))
        .set('X-Workspace-Id', ws);
    const managed = await get('/projects', f.ws.id);
    expect(managed.status).toBe(200);
    expect(managed.body.data.map((p: any) => p.title)).toEqual(['Managed unassigned']);
    const foreign = await get('/projects', other.ws.id);
    expect(foreign.body.data.map((p: any) => p.title)).toEqual(['Other assigned']);
    expect((await get('/projects/stats/status', f.ws.id)).body).toEqual({ NEW: 1 });
    expect((await get('/projects/stats/priority', f.ws.id)).body).toEqual({ MEDIUM: 1 });
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'VIEWER' },
    });
    expect((await get('/projects', f.ws.id)).body.data).toEqual([]);
    expect((await get('/projects/stats/status', f.ws.id)).body).toEqual({});
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'MANAGER', status: 'SUSPENDED' },
    });
    expect((await get('/projects', f.ws.id)).status).toBe(403);
    expect(await membership.hasManagementRole(f.owner, f.ws.id)).toBe(false);
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { status: 'ACTIVE' },
    });
    await admin.workspace.update({ where: { id: f.ws.id }, data: { status: 'suspended' } });
    expect(await membership.hasManagementRole(f.owner, f.ws.id)).toBe(false);
    await admin.workspace.update({ where: { id: f.ws.id }, data: { status: 'active' } });
    await admin.user.update({ where: { id: f.owner.id }, data: { role: 'CLIENT' } });
    // Since the client-portal boundary (0dd649d) the internal project API
    // refuses the CLIENT app role outright; clients read through /client-portal.
    for (const wsId of [f.ws.id, other.ws.id]) {
      const refused = await get('/projects', wsId);
      expect(refused.status).toBe(403);
      expect(refused.body.data).toBeUndefined();
    }
    await admin.user.update({ where: { id: f.owner.id }, data: { role: 'STAFF' } });
    const disabled = new MembershipService(
      prisma,
      new ConfigService({ PROJECT_OPS_TENANCY_ENABLED: 'false' }),
    );
    expect(await disabled.hasManagementRole(f.owner, f.ws.id)).toBe(false);
    expect((await admin.user.findUniqueOrThrow({ where: { id: f.owner.id } })).role).toBe('STAFF');
  });

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
  it('classifies machines without provisioning people and denies invitation HTTP operations', async () => {
    const f = await proposal();
    const usersBefore = await admin.user.count();
    for (const claims of [
      { iss: realmIssuer, client_id: 'project-ops', email: f.invited, email_verified: true },
      { iss: realmIssuer, azp: 'project-ops', preferred_username: 'service-account-project-ops', email: f.invited, email_verified: true },
      { iss: brigadeIssuer, aud: 'project-ops', act: { client_id: 'meeting-ops' } },
    ]) {
      const payload = { sub: randomUUID(), aud: 'project-ops', workspace_id: f.ws.id, ...claims };
      const principal = await auth.validateJwtPayload(payload);
      expect(principal).toMatchObject({ __isFederationActor: true, role: null, email: null });
      const credential = signMachine(payload);
      for (const [method, path, body] of [
        ['post', `/workspaces/${f.ws.id}/invitations`, { email: email() }],
        ['get', `/workspaces/${f.ws.id}/invitations`, {}],
        ['delete', `/workspaces/${f.ws.id}/invitations/${f.invite.id}`, {}],
        ['post', '/workspace-invitations/accept', { token: f.invite.token }],
      ] as const) {
        expect((await request(app.getHttpServer())[method](path)
          .set('Authorization', 'Bearer ' + credential).send(body)).status).toBe(403);
      }
    }
    expect(await admin.user.count()).toBe(usersBefore);
    expect((await admin.workspaceInvitation.findUniqueOrThrow({ where: { id: f.invite.id } })).status).toBe('pending');
    expect(await admin.membership.count({ where: { workspaceId: f.ws.id } })).toBe(1);
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
  it('VIEWER session and overscoped PAT cannot write REST projects/tasks/time; MEMBER writes still work', async () => {
    const f = await fixture();
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'VIEWER' },
    });
    const mint = await post(f.owner, '/auth/pats', {
      name: 'Viewer personal token',
      scopes: ['read:projects'],
      workspaceId: f.ws.id,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(mint.status).toBe(201);
    expect(
      (
        await post(f.owner, '/client-portal/projects/unknown/comments', {
          content: 'Denied staff viewer',
        })
      ).status,
    ).toBe(403);
    const p = await pat.create(f.owner, {
      name: 'isolated overscoped fixture',
      scopes: ['read:projects', 'write:projects', 'write:tasks', 'write:time'],
      workspaceId: f.ws.id,
      expiresAt: new Date(Date.now() + 60000),
    });
    for (const credential of [token(f.owner), p.plaintext])
      for (const path of ['/projects', '/tasks', '/time-entries', '/time-entries/timer/start']) {
        expect(
          (
            await request(app.getHttpServer())
              .post(path)
              .set('Authorization', 'Bearer ' + credential)
              .send({ title: 'Denied', clientName: 'Fixture' })
          ).status,
        ).toBe(403);
      }
    expect(await admin.project.count({ where: { workspaceId: f.ws.id } })).toBe(0);
    expect(
      (
        await request(app.getHttpServer())
          .get('/projects')
          .set('Authorization', 'Bearer ' + token(f.owner))
      ).status,
    ).toBe(200);
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'MEMBER' },
    });
    expect(
      (await post(f.owner, '/projects', { title: 'Member project', clientName: 'Fixture' })).status,
    ).toBe(201);
    const ingest = await request(app.getHttpServer())
      .post('/triage/ingest')
      .set('Authorization', 'Bearer ' + token(f.owner))
      .set('X-Workspace-Id', f.ws.id)
      .send({ items: [] });
    // L2 makes this route machine-only: membership never grants federation.
    expect(ingest.status).toBe(403);
    expect(ingest.body.code).toBe('FEDERATION_ACTOR_REQUIRED');
    expect(await admin.project.count({ where: { workspaceId: f.ws.id } })).toBe(1);
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'VIEWER' },
    });
    expect(
      (await post(f.owner, '/projects', { title: 'Denied after demotion', clientName: 'Fixture' }))
        .status,
    ).toBe(403);
  });
  it('real MCP POST permits reads but denies session and overscoped PAT writes; role revocation is fresh', async () => {
    const f = await fixture();
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'VIEWER' },
    });
    const p = await pat.create(f.owner, {
      name: 'isolated MCP fixture',
      scopes: ['read:projects', 'write:projects'],
      workspaceId: f.ws.id,
      expiresAt: new Date(Date.now() + 60000),
    });
    async function rpc(credential: string, name: string, args = {}) {
      const r = await request(app.getHttpServer())
        .post('/mcp')
        .set('Authorization', 'Bearer ' + credential)
        .set('Accept', 'application/json, text/event-stream')
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      expect(r.status).toBe(200);
      const row = r.text.split('\n').find((x) => x.startsWith('data: '));
      return row ? JSON.parse(row.slice(6)).result : r.body.result;
    }
    for (const credential of [token(f.owner), p.plaintext]) {
      expect((await rpc(credential, 'list_my_projects')).isError).not.toBe(true);
      const denied = await rpc(credential, 'create_project', {
        title: 'Denied MCP',
        clientName: 'Fixture',
      });
      expect(denied.isError).toBe(true);
      expect(JSON.parse(denied.content[0].text).error).toBe('workspace_write_denied');
    }
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { role: 'MEMBER' },
    });
    expect(
      (
        await rpc(token(f.owner), 'create_project', {
          title: 'Member MCP project',
          clientName: 'Fixture',
        })
      ).isError,
    ).not.toBe(true);
    expect(await admin.project.count({ where: { workspaceId: f.ws.id } })).toBe(1);
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.owner.keycloakId!, workspaceId: f.ws.id } },
      data: { status: 'SUSPENDED' },
    });
    expect(
      (
        await request(app.getHttpServer())
          .post('/mcp')
          .set('Authorization', 'Bearer ' + p.plaintext)
          .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      ).status,
    ).toBe(403);
  });
  it('actual triage guard order preserves only an allow-listed federation principal', async () => {
    const f = await fixture();
    const payload = {
      sub: 'isolated-federation-order', workspace_id: f.ws.id,
      iss: brigadeIssuer, aud: 'project-ops', act: { client_id: 'meeting-ops' },
    };
    const credential = signMachine(payload);
    try {
      config.set('PROJECT_OPS_FEDERATION_ACTORS', 'meeting-ops');
      expect(
        (
          await request(app.getHttpServer())
            .post('/triage/ingest')
            .set('Authorization', 'Bearer ' + credential)
            .send({ items: [] })
        ).status,
      ).toBe(201);
      for (const patch of [
        { act: { client_id: 'unknown-service' } },
        { workspace_id: undefined },
      ]) {
        expect((await request(app.getHttpServer()).post('/triage/ingest')
          .set('Authorization', 'Bearer ' + signMachine({ ...payload, ...patch }))
          .set('X-Workspace-Id', f.ws.id).send({ items: [] })).status).toBe(403);
      }
      expect((await request(app.getHttpServer()).post('/triage/ingest')
        .set('Authorization', 'Bearer ' + signMachine({ ...payload, aud: 'another-app' }))
        .send({ items: [] })).status).toBe(401);
      config.set('PROJECT_OPS_FEDERATION_ACTORS', '');
      expect(
        (
          await request(app.getHttpServer())
            .post('/triage/ingest')
            .set('Authorization', 'Bearer ' + credential)
            .send({ items: [] })
        ).status,
      ).toBe(403);
    } finally {
      config.set('PROJECT_OPS_FEDERATION_ACTORS', '');
    }
  });
  it('timesheet decisions emit the exact tenant and affected user audience', async () => {
    const f = await fixture();
    const manager = await admin.user.update({
      where: { id: f.owner.id },
      data: { role: 'MANAGER' },
    });
    const project = await post(manager, '/projects', {
      title: 'Time audience fixture',
      clientName: 'Fixture',
    });
    expect(project.status).toBe(201);
    const captured = jest.fn();
    const service = new TimesheetService(
      prisma,
      { log: jest.fn() } as any,
      { emit: captured } as any,
      config,
      workspace,
    );
    for (const decision of ['approve', 'reject'] as const) {
      const entry = await admin.timeEntry.create({
        data: {
          workspaceId: f.ws.id,
          userId: manager.id,
          projectId: project.body.id,
          startedAt: new Date('2026-09-01T10:00:00Z'),
          endedAt: new Date('2026-09-01T10:01:00Z'),
          durationSeconds: 60,
          approvalStatus: 'SUBMITTED',
        },
      });
      if (decision === 'approve')
        await service.approve(f.ws.id, manager, { timeEntryIds: [entry.id] });
      else
        await service.reject(f.ws.id, manager, {
          timeEntryIds: [entry.id],
          reason: 'Synthetic fixture',
        });
      expect(captured).toHaveBeenCalledWith(
        'timesheet.' + (decision === 'approve' ? 'approved' : 'rejected'),
        expect.objectContaining({ workspaceId: f.ws.id, userIds: [manager.id], count: 1 }),
      );
    }
  });
  it('real sockets enforce project/CLIENT access, deny VIEWER updates and stop revoked recipients', async () => {
    const f = await fixture(),
      foreign = await fixture();
    const createdProject = await post(f.owner, '/projects', {
      title: 'Socket fixture',
      clientName: 'Fixture',
    });
    expect(createdProject.status).toBe(201);
    const pid = createdProject.body.id;
    const peerEmail = email();
    const peer = await admin.user.create({
      data: {
        email: peerEmail,
        username: peerEmail,
        firstName: 'Peer',
        lastName: 'Fixture',
        keycloakId: randomUUID(),
        role: 'STAFF',
      },
    });
    await admin.membership.create({
      data: { userKey: peer.keycloakId!, workspaceId: f.ws.id, role: 'VIEWER' },
    });
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as any).port;
    const sockets: ClientSocket[] = [];
    async function connect(user: User, workspaceId: string) {
      const sock = io(`http://127.0.0.1:${port}/realtime`, {
        auth: { token: token(user), workspaceId },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(sock);
      await new Promise<void>((resolve, reject) => {
        sock.once('connected', () => resolve());
        sock.once('connect_error', reject);
        setTimeout(() => reject(new Error('Socket fixture auth timeout')), 3000).unref();
      });
      return sock;
    }
    async function send(sock: ClientSocket, event: string, data: any, success: string) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('Socket response timeout: ' + event)),
          2000,
        );
        const ok = () => {
          clearTimeout(timer);
          sock.off('error', error);
          resolve(success);
        };
        const error = () => {
          clearTimeout(timer);
          sock.off(success, ok);
          resolve('error');
        };
        sock.once(success, ok);
        sock.once('error', error);
        sock.emit(event, data);
      });
    }
    const gateway = app.get(RealtimeGateway);
    try {
      const writer = await connect(f.owner, f.ws.id),
        viewer = await connect(peer, f.ws.id),
        outsider = await connect(foreign.owner, foreign.ws.id);
      const events: any[] = [];
      viewer.on('project-updated', (v) => events.push(v));
      const outside: any[] = [];
      outsider.on('project-updated', (v) => outside.push(v));
      expect(await send(viewer, 'join-project', { projectId: pid }, 'joined-project')).toBe(
        'joined-project',
      );
      expect(await send(outsider, 'join-project', { projectId: pid }, 'joined-project')).toBe(
        'error',
      );
      expect(
        await send(
          viewer,
          'project-update',
          { projectId: pid, title: 'Forbidden' },
          'project-update-accepted',
        ),
      ).toBe('error');
      expect(
        await send(
          writer,
          'project-update',
          { projectId: pid, title: 'Allowed hint' },
          'project-update-accepted',
        ),
      ).toBe('project-update-accepted');
      await new Promise((r) => setTimeout(r, 50));
      expect(events).toEqual([{ projectId: pid }]);
      expect(outside).toHaveLength(0);
      await admin.membership.update({
        where: { userKey_workspaceId: { userKey: peer.keycloakId!, workspaceId: f.ws.id } },
        data: { status: 'SUSPENDED' },
      });
      await gateway.broadcastToProject(pid, 'project-updated', {
        projectId: pid,
        title: 'After revoke',
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(events).toHaveLength(1);
      expect(await send(viewer, 'join-project', { projectId: pid }, 'joined-project')).toBe(
        'error',
      );
      // A CLIENT in the same workspace still cannot subscribe to an unassigned project.
      await admin.membership.update({
        where: { userKey_workspaceId: { userKey: peer.keycloakId!, workspaceId: f.ws.id } },
        data: { status: 'ACTIVE' },
      });
      await admin.user.update({ where: { id: peer.id }, data: { role: 'CLIENT' } });
      expect(await send(viewer, 'join-project', { projectId: pid }, 'joined-project')).toBe(
        'error',
      );
      const contact = await admin.contact.create({
        data: {
          workspaceId: f.ws.id,
          userId: peer.id,
          createdById: f.owner.id,
          firstName: 'Portal',
          lastName: 'Fixture',
          email: peer.email,
        },
      });
      await admin.project.update({ where: { id: pid }, data: { contactId: contact.id } });
      // A linked contact is still fenced out until portal access is enabled
      // (portalAccessEnabled defaults to false since the 0dd649d boundary).
      expect(await send(viewer, 'join-project', { projectId: pid }, 'joined-project')).toBe(
        'error',
      );
      await admin.contact.update({
        where: { id: contact.id },
        data: { portalAccessEnabled: true },
      });
      expect(await send(viewer, 'join-project', { projectId: pid }, 'joined-project')).toBe(
        'joined-project',
      );
      await admin.membership.update({
        where: { userKey_workspaceId: { userKey: peer.keycloakId!, workspaceId: f.ws.id } },
        data: { role: 'MEMBER' },
      });
      expect(
        await send(
          viewer,
          'project-update',
          { projectId: pid, title: 'Client forged' },
          'project-update-accepted',
        ),
      ).toBe('error');
      const portalComment = await post(peer, `/client-portal/projects/${pid}/comments`, {
        content: 'Allowed portal fixture',
      });
      expect(portalComment.status).toBe(201);
      const comments: any[] = [];
      viewer.on('comment-created', (v) => comments.push(v));
      await gateway.handleCommentCreated({
        projectId: pid,
        comment: { id: 'internal', isInternal: true, content: 'Not for portal' },
      });
      await gateway.handleCommentCreated({
        projectId: pid,
        comment: {
          id: 'public',
          isInternal: false,
          content: 'Portal content',
          author: {
            id: peer.id,
            email: peer.email,
            username: peer.username,
            password: 'must-not-leak',
            keycloakId: peer.keycloakId,
          },
        },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(comments.map((x) => x.id)).toEqual(['public']);
      expect(comments[0].author.password).toBeUndefined();
      expect(comments[0].author.keycloakId).toBeUndefined();
      // Timesheet metadata reaches only the target user/authorized approvers, never another tenant.
      const ownerEvents: any[] = [];
      const foreignEvents: any[] = [];
      writer.on('timesheet-approved', (v) => ownerEvents.push(v));
      outsider.on('timesheet-approved', (v) => foreignEvents.push(v));
      await gateway.handleTimesheetApproved({
        workspaceId: f.ws.id,
        userIds: [f.owner.id],
        count: 1,
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(ownerEvents).toHaveLength(1);
      expect(foreignEvents).toHaveLength(0);
      await expect(gateway.broadcastToAll('unsafe', { private: true })).rejects.toThrow();
    } finally {
      sockets.forEach((s) => s.disconnect());
      await new Promise<void>((resolve) => app.getHttpServer().close(() => resolve()));
    }
  }, 15000);
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
