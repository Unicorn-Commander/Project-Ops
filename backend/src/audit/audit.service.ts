import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';
import { AuditLog, Prisma } from '@prisma/client';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

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

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.AuditLogWhereInput;
    orderBy?: Prisma.AuditLogOrderByWithRelationInput;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
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
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total };
  }

  async findByUser(userId: string, limit: number = 50): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
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
    });
  }

  async findByProject(projectId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
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
    });
  }

  async findByResource(resource: string, resourceId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
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
    });
  }

  async getStatsByAction(startDate?: Date, endDate?: Date): Promise<any> {
    const where: any = {};

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const stats = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: true,
    });

    return stats.reduce((acc, stat) => {
      acc[stat.action] = stat._count;
      return acc;
    }, {});
  }

  async getStatsByResource(startDate?: Date, endDate?: Date): Promise<any> {
    const where: any = {};

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = startDate;
      if (endDate) where.timestamp.lte = endDate;
    }

    const stats = await this.prisma.auditLog.groupBy({
      by: ['resource'],
      where,
      _count: true,
    });

    return stats.reduce((acc, stat) => {
      acc[stat.resource] = stat._count;
      return acc;
    }, {});
  }
}