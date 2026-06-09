/**
 * Integration test for the PAT auth flow.
 *
 * Drives the real JwtAuthGuard against in-memory Prisma + PatService
 * to prove the lifecycle that matters most:
 *   mint -> use -> revoke -> 401
 *   mint -> use -> expire -> 401
 *   mint -> use with wrong PAT -> 401
 *
 * Stops short of booting the full Nest HTTP layer (that's covered by
 * the separate integration suite under tests/integration). The point
 * here is to pin the chokepoint logic — the guard's PAT branch — so a
 * future refactor can't quietly weaken it.
 */

import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { PersonalAccessToken, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipService } from '../../common/workspace/membership.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PatService } from './pat.service';

const BOOTSTRAP_WS = '0190a000-7e57-7000-8000-00000000b007';

/** Tenancy-OFF MembershipService stub: echo requested else bootstrap. */
function makeMembership(): MembershipService {
  return {
    resolveAndAuthorize: jest.fn(
      async (_user: User, requested?: string | null) => requested?.trim() || BOOTSTRAP_WS,
    ),
  } as unknown as MembershipService;
}

// Reuse the FakePrisma from the service spec by inlining a minimal
// version here — keeping the two specs independently runnable matters
// more than DRY.
class FakePrisma {
  users = new Map<string, User>();
  tokens = new Map<string, PersonalAccessToken>();
  personalAccessToken = {
    create: async ({ data }: any) => {
      const row: PersonalAccessToken = {
        id: `pat-${this.tokens.size + 1}`,
        workspaceId: data.workspaceId ?? null,
        userId: data.userId,
        name: data.name,
        prefix: data.prefix ?? 'po_pat_',
        tokenHash: data.tokenHash,
        scopes: data.scopes ?? [],
        lastUsedAt: null,
        expiresAt: data.expiresAt ?? null,
        createdAt: new Date(),
        revokedAt: null,
      };
      this.tokens.set(row.id, row);
      return row;
    },
    findMany: async ({ where, include }: any) => {
      let rows = Array.from(this.tokens.values());
      if (where?.revokedAt === null) rows = rows.filter((r) => r.revokedAt === null);
      if (where?.AND) {
        const now = new Date();
        rows = rows.filter((r) => r.expiresAt === null || r.expiresAt > now);
      }
      if (include?.user) return rows.map((r) => ({ ...r, user: this.users.get(r.userId) }));
      return rows;
    },
    findUnique: async ({ where }: any) => this.tokens.get(where.id) ?? null,
    update: async ({ where, data }: any) => {
      const existing = this.tokens.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      this.tokens.set(where.id, updated);
      return updated;
    },
  };
}

function makeUser(): User {
  return {
    id: 'user-1',
    email: 'aaron@example.com',
    username: 'aaron',
    firstName: 'Aaron',
    lastName: 'Stransky',
    role: UserRole.ADMIN,
    keycloakId: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    password: null,
    forcePasswordChange: false,
  } as User;
}

function makeContext(
  authHeader?: string,
  extra?: { headers?: Record<string, any>; params?: Record<string, any> },
): ExecutionContext {
  const req: any = {
    headers: {
      ...(authHeader ? { authorization: authHeader } : {}),
      ...(extra?.headers ?? {}),
    },
    params: extra?.params ?? {},
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }) as any,
    getHandler: () => undefined as any,
    getClass: () => undefined as any,
  } as ExecutionContext;
}

function makeReflector(isPublic = false): Reflector {
  return { getAllAndOverride: () => isPublic } as unknown as Reflector;
}

function makeGuard(patService: PatService): JwtAuthGuard {
  const moduleRef = {
    get: () => patService,
  } as unknown as ModuleRef;
  const guard = new JwtAuthGuard(makeReflector(false), moduleRef);
  // Stub the underlying Passport JWT canActivate so a missing JWT
  // doesn't crash the test (we only care about the PAT branch here).
  (guard as any).__proto__.__proto__.canActivate = jest.fn(() => false);
  return guard;
}

describe('PAT auth flow', () => {
  let prisma: FakePrisma;
  let service: PatService;
  let user: User;

  beforeEach(() => {
    prisma = new FakePrisma();
    user = makeUser();
    prisma.users.set(user.id, user);
    service = new PatService(prisma as unknown as PrismaService, makeMembership());
  });

  it('mint -> use -> success (user attached to request)', async () => {
    const created = await service.create(user,{
      name: 'Claude Code',
      scopes: ['read:projects'],
    });
    const guard = makeGuard(service);
    const ctx = makeContext(`Bearer ${created.plaintext}`);
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
    const req: any = ctx.switchToHttp().getRequest();
    expect(req.user.id).toBe(user.id);
    expect(req.pat.scopes).toEqual(['read:projects']);
    // The PAT's workspace becomes the request's effective claim + resolved id
    // so the GUC chokepoint scopes every query to it.
    expect(req.user.__workspaceClaim).toBe(BOOTSTRAP_WS);
    expect(req.workspaceId).toBe(BOOTSTRAP_WS);
  });

  // ── Acceptance 9.6: a PAT for W1 cannot act on W2 ────────────────────────
  it('PAT bound to W1 + matching X-Workspace-Id header -> allowed', async () => {
    const created = await service.create(user, { name: 'W1', workspaceId: BOOTSTRAP_WS });
    const guard = makeGuard(service);
    const ctx = makeContext(`Bearer ${created.plaintext}`, {
      headers: { 'x-workspace-id': BOOTSTRAP_WS },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).workspaceId).toBe(BOOTSTRAP_WS);
  });

  it('PAT bound to W1 + X-Workspace-Id header for W2 -> 403', async () => {
    const created = await service.create(user, { name: 'W1', workspaceId: BOOTSTRAP_WS });
    const guard = makeGuard(service);
    const ctx = makeContext(`Bearer ${created.plaintext}`, {
      headers: { 'x-workspace-id': 'ws-2-other' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('PAT bound to W1 + path param workspaceId=W2 -> 403 (path precedence)', async () => {
    const created = await service.create(user, { name: 'W1', workspaceId: BOOTSTRAP_WS });
    const guard = makeGuard(service);
    const ctx = makeContext(`Bearer ${created.plaintext}`, {
      params: { workspaceId: 'ws-2-other' },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('PAT with no explicit workspace target -> binds to its own workspace', async () => {
    const created = await service.create(user, { name: 'W1', workspaceId: BOOTSTRAP_WS });
    const guard = makeGuard(service);
    const ctx = makeContext(`Bearer ${created.plaintext}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((ctx.switchToHttp().getRequest() as any).user.__workspaceClaim).toBe(BOOTSTRAP_WS);
  });

  it('mint -> revoke -> use -> 401', async () => {
    const created = await service.create(user,{ name: 'X' });
    await service.revoke(user.id, created.id);
    const guard = makeGuard(service);
    const ctx = makeContext(`Bearer ${created.plaintext}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('mint -> expire -> use -> 401', async () => {
    const created = await service.create(user,{
      name: 'X',
      expiresAt: new Date(Date.now() + 60_000),
    });
    // Force-expire the row directly.
    prisma.tokens.get(created.id)!.expiresAt = new Date(Date.now() - 1_000);
    const guard = makeGuard(service);
    const ctx = makeContext(`Bearer ${created.plaintext}`);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('wrong PAT plaintext -> 401', async () => {
    await service.create(user,{ name: 'X' });
    const guard = makeGuard(service);
    const ctx = makeContext('Bearer po_pat_obviously-wrong-value');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('non-PAT bearer falls through to the JWT guard', async () => {
    const guard = makeGuard(service);
    const ctx = makeContext('Bearer eyJhbGciOi.payload.sig');
    // Our stubbed super.canActivate returns false -> guard returns false.
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(false);
  });

  it('public routes bypass auth entirely', async () => {
    const moduleRef = { get: () => service } as unknown as ModuleRef;
    const guard = new JwtAuthGuard(makeReflector(true), moduleRef);
    const ctx = makeContext();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
