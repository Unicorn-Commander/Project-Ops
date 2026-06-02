import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PersonalAccessToken, User, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PatService } from './pat.service';
import { PAT_PREFIX } from './pat.constants';

/**
 * Hand-rolled in-memory Prisma stub.
 *
 * We avoid `jest-mock-extended` (not a dep) and a full
 * `prismock` dependency — the surface area we need is tiny and
 * spelling it out keeps the test honest about what the service
 * actually touches.
 */
class FakePrisma {
  users = new Map<string, User>();
  tokens = new Map<string, PersonalAccessToken>();

  personalAccessToken = {
    create: async ({ data }: any) => {
      const row: PersonalAccessToken = {
        id: `pat-${this.tokens.size + 1}`,
        userId: data.userId,
        name: data.name,
        prefix: data.prefix ?? PAT_PREFIX,
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
    findMany: async ({ where, include, orderBy }: any) => {
      let rows = Array.from(this.tokens.values());
      if (where?.userId) rows = rows.filter((r) => r.userId === where.userId);
      if (where?.revokedAt === null) rows = rows.filter((r) => r.revokedAt === null);
      if (where?.AND) {
        const exp = where.AND[0]?.OR;
        if (exp) {
          const now = exp[1]?.expiresAt?.gt ?? new Date();
          rows = rows.filter((r) => r.expiresAt === null || r.expiresAt > now);
        }
      }
      if (orderBy?.createdAt === 'desc') {
        rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      if (include?.user) {
        return rows.map((r) => ({ ...r, user: this.users.get(r.userId) }));
      }
      return rows;
    },
    findUnique: async ({ where }: any) => {
      if (where.id) return this.tokens.get(where.id) ?? null;
      return null;
    },
    update: async ({ where, data }: any) => {
      const existing = this.tokens.get(where.id);
      if (!existing) throw new Error('not found');
      const updated = { ...existing, ...data };
      this.tokens.set(where.id, updated);
      return updated;
    },
  };
}

function makeUser(overrides: Partial<User> = {}): User {
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
    ...overrides,
  } as User;
}

describe('PatService', () => {
  let prisma: FakePrisma;
  let service: PatService;
  let user: User;

  beforeEach(() => {
    prisma = new FakePrisma();
    user = makeUser();
    prisma.users.set(user.id, user);
    service = new PatService(prisma as unknown as PrismaService);
  });

  describe('create', () => {
    it('returns a plaintext token with the canonical prefix and stores the hash', async () => {
      const result = await service.create(user.id, {
        name: 'Claude Code',
        scopes: ['read:projects'],
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      expect(result.plaintext.startsWith(PAT_PREFIX)).toBe(true);
      const stored = prisma.tokens.get(result.id)!;
      expect(stored.tokenHash).not.toEqual(result.plaintext);
      expect(stored.scopes).toEqual(['read:projects']);
    });

    it('defaults to a read-only scope set when none is provided', async () => {
      const result = await service.create(user.id, { name: 'Defaults' });
      expect(result.scopes.every((s) => s.startsWith('read:'))).toBe(true);
      expect(result.scopes.length).toBeGreaterThan(0);
    });

    it('rejects an empty name', async () => {
      await expect(service.create(user.id, { name: '' })).rejects.toThrow(BadRequestException);
      await expect(service.create(user.id, { name: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('rejects unknown scopes', async () => {
      await expect(
        service.create(user.id, { name: 'X', scopes: ['read:projects', 'pwn:everything'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an expiry in the past', async () => {
      await expect(
        service.create(user.id, {
          name: 'X',
          expiresAt: new Date(Date.now() - 1000),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a null expiry as never-expiring', async () => {
      const result = await service.create(user.id, { name: 'X', expiresAt: null });
      expect(result.expiresAt).toBeNull();
    });
  });

  describe('findByPlaintext', () => {
    it('resolves the owning user when the token matches', async () => {
      const { plaintext } = await service.create(user.id, { name: 'X' });
      const resolved = await service.findByPlaintext(plaintext);
      expect(resolved?.user.id).toBe(user.id);
      expect(resolved?.token.name).toBe('X');
    });

    it('returns null on a non-PAT-shaped token', async () => {
      const resolved = await service.findByPlaintext('eyJhbGciOi.payload.sig');
      expect(resolved).toBeNull();
    });

    it('returns null when no stored hash matches the plaintext', async () => {
      await service.create(user.id, { name: 'X' });
      const resolved = await service.findByPlaintext(`${PAT_PREFIX}wrong-token`);
      expect(resolved).toBeNull();
    });

    it('returns null for revoked tokens', async () => {
      const created = await service.create(user.id, { name: 'X' });
      await service.revoke(user.id, created.id);
      const resolved = await service.findByPlaintext(created.plaintext);
      expect(resolved).toBeNull();
    });

    it('returns null for expired tokens', async () => {
      // Create with a near-future expiry, then force-expire in storage
      const created = await service.create(user.id, {
        name: 'X',
        expiresAt: new Date(Date.now() + 60_000),
      });
      const row = prisma.tokens.get(created.id)!;
      row.expiresAt = new Date(Date.now() - 1_000);
      const resolved = await service.findByPlaintext(created.plaintext);
      expect(resolved).toBeNull();
    });

    it('returns null when the owning user is inactive', async () => {
      const created = await service.create(user.id, { name: 'X' });
      prisma.users.set(user.id, { ...user, isActive: false });
      const resolved = await service.findByPlaintext(created.plaintext);
      expect(resolved).toBeNull();
    });

    it('bumps lastUsedAt on a successful resolution', async () => {
      const created = await service.create(user.id, { name: 'X' });
      expect(prisma.tokens.get(created.id)!.lastUsedAt).toBeNull();
      await service.findByPlaintext(created.plaintext);
      // The bump is fire-and-forget; await a microtask flush.
      await new Promise((r) => setImmediate(r));
      expect(prisma.tokens.get(created.id)!.lastUsedAt).not.toBeNull();
    });
  });

  describe('list', () => {
    it('returns metadata only (no plaintext, no hash)', async () => {
      await service.create(user.id, { name: 'A' });
      await service.create(user.id, { name: 'B' });
      const rows = await service.list(user.id);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect((row as any).tokenHash).toBeUndefined();
        expect((row as any).plaintext).toBeUndefined();
      }
    });

    it('omits other users tokens', async () => {
      const other = makeUser({ id: 'user-2', email: 'b@example.com' });
      prisma.users.set(other.id, other);
      await service.create(user.id, { name: 'mine' });
      await service.create(other.id, { name: 'not mine' });
      const rows = await service.list(user.id);
      expect(rows.map((r) => r.name)).toEqual(['mine']);
    });
  });

  describe('revoke', () => {
    it('soft-deletes and is idempotent', async () => {
      const created = await service.create(user.id, { name: 'X' });
      const first = await service.revoke(user.id, created.id);
      expect(first.revokedAt).not.toBeNull();
      const firstRevokedAt = first.revokedAt!;
      const second = await service.revoke(user.id, created.id);
      // Idempotent: re-revoke returns the SAME revokedAt, not a new one
      expect(second.revokedAt!.getTime()).toBe(firstRevokedAt.getTime());
    });

    it("rejects revoking another user's token", async () => {
      const other = makeUser({ id: 'user-2', email: 'b@example.com' });
      prisma.users.set(other.id, other);
      const created = await service.create(user.id, { name: 'X' });
      await expect(service.revoke(other.id, created.id)).rejects.toThrow(NotFoundException);
    });

    it('rejects revoking an unknown id', async () => {
      await expect(service.revoke(user.id, 'pat-does-not-exist')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
