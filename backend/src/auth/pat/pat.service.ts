import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PersonalAccessToken, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipService } from '../../common/workspace/membership.service';
import { PAT_AVAILABLE_SCOPES, PAT_PREFIX, PatScope } from './pat.constants';
import { generatePat, isPatToken, verifyPat } from './pat.util';

export interface CreatePatInput {
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
  /**
   * Workspace to bind the token to. When provided it MUST be a workspace the
   * caller is an active member of (enforced via MembershipService); when
   * omitted the token binds to the caller's default-membership workspace.
   */
  workspaceId?: string | null;
}

export interface CreatePatResult {
  id: string;
  plaintext: string;
  prefix: string;
  name: string;
  scopes: string[];
  workspaceId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

/**
 * Metadata view of a PAT — safe to return to the owning user. Never
 * includes the plaintext token or the bcrypt hash.
 */
export interface PatMetadata {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  workspaceId: string | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface PatResolution {
  user: User;
  token: PersonalAccessToken;
  /**
   * The workspace this PAT is bound to (PersonalAccessToken.workspaceId). The
   * auth chokepoint enforces that the request's resolved workspace equals this
   * value; the MCP layer threads it so tool calls fail closed on a mismatch.
   * May be null for tokens minted before workspace-scoping landed.
   */
  workspaceId: string | null;
}

@Injectable()
export class PatService {
  private readonly logger = new Logger(PatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
  ) {}

  /**
   * Create a PAT for a user. Returns the plaintext token exactly once;
   * callers MUST surface it to the user and never persist it again.
   *
   * The token is bound to a single workspace: the explicit `workspaceId` when
   * supplied (validated to be one the caller is an ACTIVE member of), else the
   * caller's default-membership workspace. Resolution + membership enforcement
   * go through MembershipService so the behavior matches every other workspace
   * gate — a no-op echo while PROJECT_OPS_TENANCY_ENABLED is off, a hard 403 on
   * a non-member workspace when it is on.
   */
  async create(user: User, input: CreatePatInput): Promise<CreatePatResult> {
    const name = (input.name ?? '').trim();
    if (!name) {
      throw new BadRequestException('Token name is required');
    }
    if (name.length > 100) {
      throw new BadRequestException('Token name must be 100 characters or less');
    }

    const scopes = this.normalizeScopes(input.scopes);
    const expiresAt = this.normalizeExpiry(input.expiresAt);
    // Resolve + authorize the bound workspace. With tenancy off this echoes the
    // requested id (or the configured default) and never throws; with tenancy
    // on it 403s unless `user` is an active member of the target workspace, and
    // picks their default membership when no explicit target was given.
    const workspaceId = await this.membership.resolveAndAuthorize(
      user,
      input.workspaceId ?? null,
    );

    const { plaintext, hash: hashPromise } = generatePat();
    const tokenHash = await hashPromise;

    const row = await this.prisma.personalAccessToken.create({
      data: {
        userId: user.id,
        workspaceId,
        name,
        prefix: PAT_PREFIX,
        tokenHash,
        scopes,
        expiresAt,
      },
    });

    this.logger.log(
      `Minted PAT ${row.id} for user ${user.id} (workspace=${workspaceId}, scopes=[${scopes.join(',')}], expiresAt=${expiresAt?.toISOString() ?? 'never'})`,
    );

    return {
      id: row.id,
      plaintext,
      prefix: row.prefix,
      name: row.name,
      scopes: row.scopes,
      workspaceId: row.workspaceId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  /**
   * Resolve a plaintext PAT to its owning user. Returns null on any
   * failure (no match, revoked, expired, owner inactive) so the caller
   * can convert into a single generic 401.
   *
   * Bumps `lastUsedAt` on a successful hit. Complexity is O(n) over the
   * candidate set (active tokens with the right prefix); with a handful
   * of tokens per user this is fine. If volume ever justifies it, we
   * can add a fast lookup hash (first 8 bytes of SHA-256) as a B-tree
   * index and bcrypt-verify only the prefix-matched candidates.
   */
  async findByPlaintext(plaintext: string): Promise<PatResolution | null> {
    if (!isPatToken(plaintext)) return null;

    const now = new Date();
    const candidates = await this.prisma.personalAccessToken.findMany({
      where: {
        revokedAt: null,
        AND: [
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        ],
      },
      include: { user: true },
    });

    for (const token of candidates) {
      // eslint-disable-next-line no-await-in-loop
      const match = await verifyPat(plaintext, token.tokenHash);
      if (!match) continue;
      if (!token.user || !token.user.isActive) return null;

      // Fire-and-forget the lastUsedAt bump. If it fails we still let
      // the auth succeed — losing a timestamp update is not worth a 500.
      this.prisma.personalAccessToken
        .update({
          where: { id: token.id },
          data: { lastUsedAt: now },
        })
        .catch((err) => {
          this.logger.warn(
            `Failed to bump lastUsedAt for PAT ${token.id}: ${(err as Error).message}`,
          );
        });

      // Strip the relation from the returned token shape so callers
      // can't accidentally lean on `token.user` (we already return it).
      const { user, ...bare } = token;
      const bareToken = bare as PersonalAccessToken;
      return { user, token: bareToken, workspaceId: bareToken.workspaceId };
    }

    return null;
  }

  /**
   * List the user's PATs (metadata only — no hash, no plaintext).
   * Sorted newest first; revoked tokens included so the UI can show
   * an audit trail but greyed out.
   */
  async list(userId: string): Promise<PatMetadata[]> {
    const rows = await this.prisma.personalAccessToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      workspaceId: r.workspaceId,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
      revokedAt: r.revokedAt,
    }));
  }

  /**
   * Soft-delete: mark the PAT as revoked. Idempotent — re-revoking a
   * revoked token is a no-op rather than an error so the UI doesn't
   * have to race state.
   */
  async revoke(userId: string, id: string): Promise<PatMetadata> {
    const existing = await this.prisma.personalAccessToken.findUnique({
      where: { id },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Token not found');
    }
    if (existing.revokedAt) {
      return {
        id: existing.id,
        name: existing.name,
        prefix: existing.prefix,
        scopes: existing.scopes,
        workspaceId: existing.workspaceId,
        lastUsedAt: existing.lastUsedAt,
        expiresAt: existing.expiresAt,
        createdAt: existing.createdAt,
        revokedAt: existing.revokedAt,
      };
    }
    const updated = await this.prisma.personalAccessToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    this.logger.log(`Revoked PAT ${id} for user ${userId}`);
    return {
      id: updated.id,
      name: updated.name,
      prefix: updated.prefix,
      scopes: updated.scopes,
      workspaceId: updated.workspaceId,
      lastUsedAt: updated.lastUsedAt,
      expiresAt: updated.expiresAt,
      createdAt: updated.createdAt,
      revokedAt: updated.revokedAt,
    };
  }

  private normalizeScopes(scopes?: string[]): PatScope[] {
    if (!scopes || scopes.length === 0) {
      // Default-deny is a poor UX for a brand-new token; default to
      // read-only across the board so a newly-minted PAT works for
      // observation immediately but not for mutation.
      return ['read:projects', 'read:tasks', 'read:documents', 'read:activity'];
    }
    const allowed = new Set<string>(PAT_AVAILABLE_SCOPES);
    const cleaned = Array.from(new Set(scopes.map((s) => s.trim()).filter(Boolean)));
    const invalid = cleaned.filter((s) => !allowed.has(s));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Unknown scope(s): ${invalid.join(', ')}. Allowed: ${PAT_AVAILABLE_SCOPES.join(', ')}`,
      );
    }
    return cleaned as PatScope[];
  }

  private normalizeExpiry(expiresAt?: Date | string | null): Date | null {
    if (expiresAt === null || expiresAt === undefined || expiresAt === '') {
      return null;
    }
    const d = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('expiresAt must be a valid date');
    }
    if (d.getTime() <= Date.now()) {
      throw new BadRequestException('expiresAt must be in the future');
    }
    return d;
  }
}
