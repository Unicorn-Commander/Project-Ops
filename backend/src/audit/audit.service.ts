import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditLog, Prisma, User } from '@prisma/client';

/**
 * Audit log store + read surface.
 *
 * SUITE TENANCY (Phase 2, B8): every audit-log READ runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace; all read DB access goes through the
 * passed `tx`, never `this.prisma`. `audit_logs` is one of the 9 RLS-scoped
 * wire-through tables (workspaceId column + index + workspace_isolation policy).
 *
 * The `log()` WRITE path has two shapes.
 *
 * - The caller already holds the workspace transaction (`tx`). The insert runs
 *   on that `tx`. This is required when `projectId` or `userId` was inserted
 *   in the same transaction and is not committed yet. `runInWorkspace` checks
 *   out a second pooled connection; Postgres then rejects the row with
 *   `audit_logs_projectId_fkey` / `audit_logs_userId_fkey` because the parent
 *   is invisible. The caller's `withWorkspace` already set the RLS GUCs, so a
 *   second transaction is neither needed nor safe. A failure on `tx` is
 *   rethrown: a failed statement aborts that transaction, and returning null
 *   would leave the caller running on a dead tx.
 *
 * - No `tx`. The create runs inside the DTO's workspace GUC via
 *   `runInWorkspace`, so the row satisfies the RLS WITH CHECK under the
 *   NOBYPASSRLS runtime role. (The original A1 note assumed a BYPASSRLS owner
 *   connection — the runtime flipped to project_ops_app on 2026-06-09 and bare
 *   creates were silently rejected by WITH CHECK until this fix; the catch's
 *   never-throw contract hid it. 0 rows landed 06-09→06-10.) A DTO without a
 *   workspaceId falls back to a bare create: correct while tenancy is off
 *   (owner connection), and correctly fail-closed (logged, never thrown) if a
 *   future unstamped caller appears under RLS. Callers that audit after their
 *   own commit (comments, approvals) use this shape; the parent row is already
 *   visible, so the foreign key holds.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async log(
    createAuditLogDto: CreateAuditLogDto,
    tx?: WorkspaceTxClient,
  ): Promise<AuditLog | null> {
    try {
      // Under the NOBYPASSRLS runtime role the WITH CHECK policy requires the
      // row's workspaceId to equal the GUC. A caller-supplied `tx` already has
      // that GUC (withWorkspace set it) and can see rows this transaction has
      // inserted but not committed. Otherwise runInWorkspace opens that scope
      // on a new connection. It performs no membership check: audit is a
      // system write, already authorized by the calling request.
      const auditLog = tx
        ? await tx.auditLog.create({ data: createAuditLogDto })
        : createAuditLogDto.workspaceId
          ? await this.workspaceContext.runInWorkspace(
              createAuditLogDto.workspaceId,
              createAuditLogDto.userId ?? '',
              (inner) => inner.auditLog.create({ data: createAuditLogDto }),
            )
          : await this.prisma.auditLog.create({ data: createAuditLogDto });

      this.logger.debug(
        `Audit log created: ${createAuditLogDto.action} on ${createAuditLogDto.resource}`,
      );

      return auditLog;
    } catch (error) {
      this.logger.error('Failed to create audit log', error);
      // A failed statement aborts `tx`. Swallowing it would let the caller
      // continue and then fail with "current transaction is aborted".
      if (tx) throw error;
      // Standalone writes must not break a request whose own work already
      // committed (or never shared this transaction).
      return null;
    }
  }

  async findAll(
    workspaceId: string,
    user: User,
    params?: {
      skip?: number;
      take?: number;
      where?: Prisma.AuditLogWhereInput;
      orderBy?: Prisma.AuditLogOrderByWithRelationInput;
    },
  ): Promise<{ logs: AuditLog[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [logs, total] = await Promise.all([
          tx.auditLog.findMany({
            skip,
            take,
            where,
            orderBy,
            include: {
              user: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
              project: {
                select: {
                  id: true,
                  projectNumber: true,
                  title: true,
                },
              },
            },
          }),
          tx.auditLog.count({ where }),
        ]);

        return { logs, total };
      },
      workspaceId,
    );
  }

  async findByUser(
    workspaceId: string,
    user: User,
    userId: string,
    limit: number = 50,
  ): Promise<AuditLog[]> {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.auditLog.findMany({
          where: { userId },
          orderBy: { timestamp: 'desc' },
          take: limit,
          include: {
            project: {
              select: {
                id: true,
                projectNumber: true,
                title: true,
              },
            },
          },
        }),
      workspaceId,
    );
  }

  async findByProject(workspaceId: string, user: User, projectId: string): Promise<AuditLog[]> {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.auditLog.findMany({
          where: { projectId },
          orderBy: { timestamp: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      workspaceId,
    );
  }

  async findByResource(
    workspaceId: string,
    user: User,
    resource: string,
    resourceId: string,
  ): Promise<AuditLog[]> {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.auditLog.findMany({
          where: {
            resource,
            resourceId,
          },
          orderBy: { timestamp: 'desc' },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      workspaceId,
    );
  }

  async getStatsByAction(
    workspaceId: string,
    user: User,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    const where: any = {};

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const stats = await tx.auditLog.groupBy({
          by: ['action'],
          where,
          _count: true,
        });

        return stats.reduce((acc, stat) => {
          acc[stat.action] = stat._count;
          return acc;
        }, {});
      },
      workspaceId,
    );
  }

  async getStatsByResource(
    workspaceId: string,
    user: User,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    const where: any = {};

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const stats = await tx.auditLog.groupBy({
          by: ['resource'],
          where,
          _count: true,
        });

        return stats.reduce((acc, stat) => {
          acc[stat.resource] = stat._count;
          return acc;
        }, {});
      },
      workspaceId,
    );
  }
}
