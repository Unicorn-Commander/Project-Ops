import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, Prisma, User, WorkspaceRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipService } from '../common/workspace/membership.service';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
@Injectable()
export class WorkspaceInvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async owner(tx: Prisma.TransactionClient, user: User, workspaceId: string) {
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${workspaceId} FOR SHARE`;
    const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
    if (!ws || ws.status !== 'active') throw new ForbiddenException('Workspace is not active.');
    const key = MembershipService.membershipKey(user);
    await tx.$queryRaw`SELECT "userKey" FROM memberships WHERE "workspaceId"=${workspaceId} AND "userKey"=${key} FOR SHARE`;
    const member = await tx.membership.findUnique({
      where: { userKey_workspaceId: { userKey: key, workspaceId } },
    });
    if (member?.status !== MembershipStatus.ACTIVE || member.role !== WorkspaceRole.OWNER)
      throw new ForbiddenException('Workspace owner session required.');
    return key;
  }

  async create(user: User, workspaceId: string, email: string, role: WorkspaceRole) {
    const normalized = email.trim().toLowerCase();
    if (
      !normalized ||
      !normalized.includes('@') ||
      ![
        WorkspaceRole.VIEWER,
        WorkspaceRole.MEMBER,
        WorkspaceRole.MANAGER,
        WorkspaceRole.ADMIN,
      ].includes(role as any)
    )
      throw new BadRequestException('Invalid email or invitation role.');
    const token = randomBytes(32).toString('base64url');
    return this.prisma.$transaction(async (tx) => {
      const actor = await this.owner(tx, user, workspaceId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${workspaceId + ':' + normalized},0))::text`;
      const existingUser = await tx.user.findFirst({
        where: { email: { equals: normalized, mode: 'insensitive' } },
      });
      if (
        existingUser &&
        (await tx.membership.findUnique({
          where: {
            userKey_workspaceId: {
              workspaceId,
              userKey: MembershipService.membershipKey(existingUser),
            },
          },
        }))
      )
        throw new ConflictException('This user already has a membership; manage it explicitly.');
      await tx.workspaceInvitation.updateMany({
        where: {
          workspaceId,
          email: normalized,
          status: 'pending',
          expiresAt: { lte: new Date() },
        },
        data: { status: 'expired' },
      });
      if (
        await tx.workspaceInvitation.findFirst({
          where: { workspaceId, email: normalized, status: 'pending' },
        })
      )
        throw new ConflictException(
          'A pending invitation exists; revoke it before issuing another.',
        );
      const invite = await tx.workspaceInvitation.create({
        data: {
          workspaceId,
          email: normalized,
          role,
          tokenHash: hash(token),
          createdByKey: actor,
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return {
        id: invite.id,
        workspaceId,
        email: normalized,
        role,
        expiresAt: invite.expiresAt,
        token,
      };
    });
  }

  async list(user: User, workspaceId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.owner(tx, user, workspaceId);
      return tx.workspaceInvitation.findMany({
        where: { workspaceId, status: 'pending', expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, expiresAt: true },
        orderBy: { createdAt: 'desc' },
      });
    });
  }

  async revoke(user: User, workspaceId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.owner(tx, user, workspaceId);
      const result = await tx.workspaceInvitation.updateMany({
        where: { id, workspaceId, status: 'pending' },
        data: { status: 'revoked' },
      });
      if (!result.count) throw new NotFoundException('Pending invitation not found.');
      return { revoked: true };
    });
  }

  async accept(user: User, token: string) {
    if (!(user as any).__verifiedEmail)
      throw new ForbiddenException('Sign in through SSO with a verified email to accept.');
    const tokenHash = hash(token);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspace_invitations WHERE "tokenHash"=${tokenHash} FOR UPDATE`;
      const invite = await tx.workspaceInvitation.findUnique({ where: { tokenHash } });
      if (!invite || invite.status !== 'pending' || invite.expiresAt <= new Date())
        throw new BadRequestException('Invitation is invalid or expired.');
      if (invite.email !== user.email.trim().toLowerCase())
        throw new ForbiddenException('Invitation belongs to a different email.');
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${invite.workspaceId} FOR SHARE`;
      const ws = await tx.workspace.findUnique({ where: { id: invite.workspaceId } });
      if (!ws || ws.status !== 'active') throw new ForbiddenException('Workspace is not active.');
      const userKey = MembershipService.membershipKey(user);
      // A concurrent grant may win the insert; never overwrite its role or status.
      await tx.$executeRaw`INSERT INTO memberships ("userKey", "workspaceId", role, status, "isDefault", "createdAt")
        VALUES (${userKey}, ${ws.id}, ${invite.role}::"WorkspaceRole", 'ACTIVE'::"MembershipStatus", false, NOW())
        ON CONFLICT ("userKey", "workspaceId") DO NOTHING`;
      await tx.$queryRaw`SELECT "userKey" FROM memberships WHERE "workspaceId"=${ws.id} AND "userKey"=${userKey} FOR UPDATE`;
      const joined = await tx.membership.findUniqueOrThrow({
        where: { userKey_workspaceId: { userKey, workspaceId: ws.id } },
      });
      if (joined.status !== MembershipStatus.ACTIVE)
        throw new ForbiddenException('Membership is suspended or revoked.');
      if (invite.expiresAt <= new Date())
        throw new BadRequestException('Invitation is invalid or expired.');
      await tx.workspaceInvitation.update({
        where: { id: invite.id },
        data: { status: 'accepted', acceptedByKey: userKey, acceptedAt: new Date() },
      });
      return {
        workspaceId: ws.id,
        displayName: ws.displayName,
        slug: ws.slug,
        role: joined.role,
        isDefault: joined.isDefault,
      };
    });
  }
}
