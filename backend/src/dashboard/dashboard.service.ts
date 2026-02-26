import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectStatus, User, UserRole, Prisma } from '@prisma/client';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(private prisma: PrismaService) {}

  async getOverview(user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    const [
      totalProjects,
      totalUsers,
      totalDocuments,
      activeProjects,
      completedProjects,
      upcomingDeadlines,
    ] = await Promise.all([
      this.prisma.project.count({ where: roleWhere }),
      // Only admins and managers see user count
      user.role === UserRole.ADMIN || user.role === UserRole.MANAGER
        ? this.prisma.user.count()
        : Promise.resolve(0),
      this.prisma.document.count({ where: { project: roleWhere } }),
      this.prisma.project.count({
        where: {
          ...roleWhere,
          status: {
            in: [ProjectStatus.NEW, ProjectStatus.IN_PROGRESS, ProjectStatus.UNDER_REVIEW],
          },
        },
      }),
      this.prisma.project.count({
        where: { ...roleWhere, status: ProjectStatus.COMPLETED },
      }),
      this.prisma.project.count({
        where: {
          ...roleWhere,
          dueDate: {
            gte: new Date(),
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Next 7 days
          },
          status: { not: ProjectStatus.COMPLETED },
        },
      }),
    ]);

    return {
      totalProjects,
      totalUsers,
      totalDocuments,
      activeProjects,
      completedProjects,
      upcomingDeadlines,
    };
  }

  async getProjectStatistics(user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    const [byStatus, byPriority, recentProjects] = await Promise.all([
      this.getProjectsByStatus(user),
      this.getProjectsByPriority(user),
      this.getRecentProjects(10, user),
    ]);

    return {
      byStatus,
      byPriority,
      recentProjects,
    };
  }

  async getProjectsByStatus(user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    const stats = await this.prisma.project.groupBy({
      by: ['status'],
      where: roleWhere,
      _count: true,
    });

    return stats.map((stat) => ({
      status: stat.status,
      count: stat._count,
    }));
  }

  async getProjectsByPriority(user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    const stats = await this.prisma.project.groupBy({
      by: ['priority'],
      where: roleWhere,
      _count: true,
    });

    return stats.map((stat) => ({
      priority: stat.priority,
      count: stat._count,
    }));
  }

  async getRecentProjects(limit: number = 10, user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    return this.prisma.project.findMany({
      where: roleWhere,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            documents: true,
            comments: true,
          },
        },
      },
    });
  }

  async getUpcomingDueDates(days: number = 7, user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    return this.prisma.project.findMany({
      where: {
        ...roleWhere,
        dueDate: {
          gte: today,
          lte: futureDate,
        },
        status: { not: ProjectStatus.COMPLETED },
      },
      orderBy: { dueDate: 'asc' },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async getUserActivity(userId: string) {
    const [createdProjects, assignedProjects, comments, documents] = await Promise.all([
      this.prisma.project.count({ where: { createdById: userId } }),
      this.prisma.project.count({ where: { assignedToId: userId } }),
      this.prisma.comment.count({ where: { authorId: userId } }),
      this.prisma.document.count({ where: { uploadedById: userId } }),
    ]);

    return {
      createdProjects,
      assignedProjects,
      comments,
      documents,
    };
  }

  async getRecentActivity(limit: number = 20) {
    const recentAuditLogs = await this.prisma.auditLog.findMany({
      take: limit,
      orderBy: { timestamp: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
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
    });

    return recentAuditLogs;
  }

  async getMonthlyStats(year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const [
      projectsCreated,
      projectsCompleted,
      documentsUploaded,
      commentsPosted,
    ] = await Promise.all([
      this.prisma.project.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
      this.prisma.project.count({
        where: {
          completedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
      this.prisma.document.count({
        where: {
          uploadedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
      this.prisma.comment.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
    ]);

    return {
      year,
      month,
      projectsCreated,
      projectsCompleted,
      documentsUploaded,
      commentsPosted,
    };
  }

  /**
   * Build where clause based on user role for row-level security
   */
  private buildRoleBasedWhere(user: User): Prisma.ProjectWhereInput {
    if (user.role === UserRole.CLIENT) {
      return { createdById: user.id };
    } else if (user.role === UserRole.STAFF) {
      return { assignedToId: user.id };
    }
    // ADMIN and MANAGER see all projects
    return {};
  }
}