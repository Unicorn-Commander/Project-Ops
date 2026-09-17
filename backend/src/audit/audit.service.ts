import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
 * The `log()` WRITE path: callers pass `workspaceId` in the DTO (every caller
 * does — grep-verified) and the create runs inside that workspace's GUC via
 * `runInWorkspace`, so the row satisfies the RLS WITH CHECK under the
 * NOBYPASSRLS runtime role. (The original A1 note assumed a BYPASSRLS owner
 * connection — the runtime flipped to project_ops_app on 2026-06-09 and bare
 * creates were silently rejected by WITH CHECK until this fix; the catch's
 * never-throw contract hid it. 0 rows landed 06-09→06-10.) A DTO without a
 * workspaceId falls back to a bare create: correct while tenancy is off
 * (owner connection), and correctly fail-closed (logged, never thrown) if a
 * future unstamped caller appears under RLS.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async log(createAuditLogDto: CreateAuditLogDto): Promise<AuditLog | null> {
    try {
      // Under the NOBYPASSRLS runtime role the WITH CHECK policy requires the
      // row's workspaceId to equal the GUC — so the write must run inside the
      // DTO's workspace context. runInWorkspace performs no membership check
      // (audit is a system write, already authorized by the calling request).
      const auditLog = createAuditLogDto.workspaceId
        ? await this.workspaceContext.runInWorkspace(
            createAuditLogDto.workspaceId,
            createAuditLogDto.userId ?? '',
            (tx) => tx.auditLog.create({ data: createAuditLogDto }),
          )
        : await this.prisma.auditLog.create({ data: createAuditLogDto });

      this.logger.debug(
        `Audit log created: ${createAuditLogDto.action} on ${createAuditLogDto.resource}`,
      );

      return auditLog;
    } catch (error) {
      this.logger.error('Failed to create audit log', error);
      // Don't throw - audit logging should not break application flow
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
