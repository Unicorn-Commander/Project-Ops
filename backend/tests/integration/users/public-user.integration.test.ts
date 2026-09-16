import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe, Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaClient, User, UserRole, WorkspaceRole } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { UsersService } from '../../../src/users/users.service';
import { AuthService } from '../../../src/auth/auth.service';
import { JwtStrategy } from '../../../src/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from '../../../src/auth/guards/jwt-auth.guard';
import { PatService } from '../../../src/auth/pat/pat.service';
import { MembershipService } from '../../../src/common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../../../src/common/workspace/workspace-membership.guard';

import { UsersController } from '../../../src/users/users.controller';
import { PublicUserInterceptor } from '../../../src/common/serialization/public-user.interceptor';
import { publicMcpUserPayload } from '../../../src/common/serialization/public-user';
let nestedUser: User;
@Controller('public-proof')
class NestedProofController {
  @Get() nested() {
    return {
      createdBy: nestedUser,
      nested: [{ author: nestedUser }],
      capability: { token: 'explicit-one-time-token' },
    };
  }
}
const adminUrl = process.env.INVITATION_ADMIN_DATABASE_URL;
const appUrl = process.env.INVITATION_APP_DATABASE_URL;
const suite = adminUrl && appUrl ? describe : describe.skip;
suite('public user lookup and nested response disclosure: real HTTP/PostgreSQL', () => {
  let app: INestApplication,
    admin: PrismaClient,
    prisma: PrismaService,
    auth: AuthService,
    membership: MembershipService,
    config: ConfigService,
    pat: PatService;
  const mail = jest.fn(() => {
    throw new Error('No email');
  });
  const jwt = new JwtService({ secret: 'isolated-workspace-invite-test-only' });
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

    pat = new PatService(prisma, membership);
    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [UsersController, NestedProofController],
      providers: [
        JwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: WorkspaceMembershipGuard },
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: config },
        { provide: PatService, useValue: pat },
        { provide: MembershipService, useValue: membership },
        { provide: UsersService, useValue: new UsersService(prisma) },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new PublicUserInterceptor());
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
    // Delete only this suite's synthetic relations, including a prior interrupted run.
    const fixtureUser = { email: { endsWith: '@public-user.example', mode: 'insensitive' as const } };
    await admin.comment.deleteMany({ where: { author: fixtureUser } });
    await admin.project.deleteMany({ where: { createdBy: fixtureUser } });
    await admin.workspace.deleteMany({ where: { id: { in: created } } });
    await admin.user.deleteMany({
      where: { email: { endsWith: '@public-user.example', mode: 'insensitive' } },
    });
    await prisma.$disconnect();
    await admin.$disconnect();
  });
  async function fixture() {
    const ws = await admin.workspace.create({
      data: { id: randomUUID(), slug: randomUUID(), displayName: 'Public lookup fixture' },
    });
    created.push(ws.id);
    const make = async (role: UserRole = UserRole.STAFF, joined = true) => {
      const email = randomUUID() + '@public-user.example';
      const u = await admin.user.create({
        data: {
          email,
          username: email,
          firstName: 'Synthetic',
          lastName: 'User',
          role,
          keycloakId: randomUUID(),
          password: 'fixture-password-hash',
        },
      });
      if (joined)
        await admin.membership.create({
          data: {
            userKey: u.keycloakId!,
            workspaceId: ws.id,
            role: WorkspaceRole.VIEWER,
            status: 'ACTIVE',
          },
        });
      return u;
    };
    const caller = await make();
    const peer = await make();
    const foreign = await make(UserRole.STAFF, false);
    return { ws, caller, peer, foreign, make };
  }
  const get = (u: User, ws: string, path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Authorization', 'Bearer ' + jwt.sign({ sub: u.id, email: u.email }))
      .set('X-Workspace-Id', ws);
  it('permits self/active co-member, refuses foreign and suspended targets without disclosing credentials', async () => {
    const f = await fixture();
    for (const u of [f.caller, f.peer]) {
      const r = await get(f.caller, f.ws.id, '/users/' + u.id);
      expect(r.status).toBe(200);
      expect(r.body.id).toBe(u.id);
      expect(r.body.password).toBeUndefined();
      expect(r.body.keycloakId).toBeUndefined();
      expect(r.body._count).toEqual({ createdProjects: 0, assignedProjects: 0, comments: 0 });
    }
    expect((await get(f.caller, f.ws.id, '/users/' + f.foreign.id)).status).toBe(404);
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.peer.keycloakId!, workspaceId: f.ws.id } },
      data: { status: 'SUSPENDED' },
    });
    expect((await get(f.caller, f.ws.id, '/users/' + f.peer.id)).status).toBe(404);
    expect((await get(f.caller, f.ws.id, '/users/' + randomUUID())).status).toBe(404);
  });
  it('counts only work in the requested workspace', async () => {
    const f = await fixture();
    const other = await fixture();
    for (const ws of [f.ws.id, other.ws.id]) {
      const project = await admin.project.create({
        data: {
          workspaceId: ws,
          projectNumber: randomUUID(),
          title: 'Synthetic count proof',
          clientName: 'Synthetic',
          createdById: f.peer.id,
          assignedToId: f.peer.id,
        },
      });
      await admin.comment.create({
        data: {
          workspaceId: ws,
          projectId: project.id,
          authorId: f.peer.id,
          content: 'Synthetic count proof',
        },
      });
    }
    const r = await get(f.caller, f.ws.id, '/users/' + f.peer.id);
    expect(r.status).toBe(200);
    expect(r.body._count).toEqual({ createdProjects: 1, assignedProjects: 1, comments: 1 });
  });
  it('retains explicit global administrator lookup but rejects a revoked caller membership', async () => {
    const f = await fixture();
    const manager = await f.make(UserRole.ADMIN);
    expect((await get(manager, f.ws.id, '/users/' + f.foreign.id)).status).toBe(200);
    await admin.membership.update({
      where: { userKey_workspaceId: { userKey: f.caller.keycloakId!, workspaceId: f.ws.id } },
      data: { status: 'REVOKED' },
    });
    expect((await get(f.caller, f.ws.id, '/users/' + f.peer.id)).status).toBe(403);
  });
  it('strips nested full User credentials over HTTP while preserving internal auth records and explicit tokens', async () => {
    const f = await fixture();
    nestedUser = Object.assign(f.peer, { __verifiedEmail: true });
    const r = await get(f.caller, f.ws.id, '/public-proof');
    expect(r.status).toBe(200);
    expect(r.body.createdBy.id).toBe(f.peer.id);
    expect(JSON.stringify(r.body)).not.toContain('fixture-password-hash');
    expect(JSON.stringify(r.body)).not.toContain('__verifiedEmail');
    expect(JSON.stringify(r.body)).not.toContain(f.peer.keycloakId!);
    expect(r.body.capability.token).toBe('explicit-one-time-token');
    expect((await new UsersService(prisma).findOne(f.peer.id)).password).toBe(
      'fixture-password-hash',
    );
  });
  it('projects both MCP JSON-text and structured user relations, preserving plain text and dates', async () => {
    const f = await fixture();
    const input = {
      content: [
        { type: 'text', text: JSON.stringify({ assignedTo: f.peer }) },
        { type: 'text', text: 'plain message' },
      ],
      structuredContent: { author: f.peer },
    };
    const out = publicMcpUserPayload(input);
    expect(JSON.stringify(out)).not.toContain('fixture-password-hash');
    expect(JSON.stringify(out)).not.toContain(f.peer.keycloakId!);
    expect(out.content[1].text).toBe('plain message');
    expect(out.structuredContent.author.createdAt).toBeInstanceOf(Date);
    expect(input.structuredContent.author.password).toBe('fixture-password-hash');
  });
});
