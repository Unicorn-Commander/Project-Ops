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
 * The `log()` WRITE path is the sanctioned exception (blueprint A1): callers
 * pass `workspaceId` in the DTO and it persists via the BYPASSRLS owner
 * connection so audit logging can never be silenced by RLS or break the calling
 * request's flow. Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off
 * (membership resolution is a no-op and withWorkspace runs under the BYPASSRLS
 * owner connection).
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
      const auditLog = await this.prisma.auditLog.create({
        data: createAuditLogDto,
      });

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

  async findByProject(
    workspaceId: string,
    user: User,
    projectId: string,
  ): Promise<AuditLog[]> {
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