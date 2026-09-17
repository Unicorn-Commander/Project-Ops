import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { ProjectStatus, User, UserRole, Prisma } from '@prisma/client';

/**
 * Dashboard aggregates: overview counts, project statistics, due-date lists,
 * per-user activity, recent system activity, and monthly rollups.
 *
 * SUITE TENANCY (Phase 2, B7): every batch of reads runs inside a single
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes the scoped tables (projects/documents/comments/audit_logs) to
 * the active workspace. ALL DB access goes through the passed `tx`, never
 * `this.prisma` — and each `Promise.all` batch is moved INSIDE one runForUser
 * callback so the whole aggregate is computed under one workspace-pinned
 * transaction (R4: a Promise.all left outside the tx would run unscoped). The
 * `users` table is intentionally NOT workspace-scoped (not in scoped_tables), so
 * the admin/manager user-count simply runs through `tx` alongside the rest of
 * its batch.
 *
 * RBAC (buildRoleBasedWhere) is a SEPARATE concern from tenancy and is left as
 * is: it narrows by role (CLIENT/STAFF) within whatever workspace RLS already
 * fenced. Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off (membership
 * resolution is a no-op and withWorkspace runs under the BYPASSRLS owner
 * connection).
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async getOverview(workspaceId: string, user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [
          totalProjects,
          totalUsers,
          totalDocuments,
          activeProjects,
          completedProjects,
          upcomingDeadlines,
        ] = await Promise.all([
          tx.project.count({ where: roleWhere }),
          // Only admins and managers see user count (users are not workspace-scoped)
          user.role === UserRole.ADMIN || user.role === UserRole.MANAGER
            ? tx.user.count()
            : Promise.resolve(0),
          tx.document.count({ where: { project: roleWhere } }),
          tx.project.count({
            where: {
              ...roleWhere,
              status: {
                in: [ProjectStatus.NEW, ProjectStatus.IN_PROGRESS, ProjectStatus.UNDER_REVIEW],
              },
            },
          }),
          tx.project.count({
            where: { ...roleWhere, status: ProjectStatus.COMPLETED },
          }),
          tx.project.count({
            where: {
              ...roleWhere,
              dueDate: {
                gte: new Date(),
                lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next 7 days
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
      },
      workspaceId,
    );
  }

  /**
   * Lightweight status/priority COUNTS for the dashboard charts.
   *
   * Replaces the frontend anti-pattern of fetching `?limit=1000` projects just
   * to bucket them client-side: the aggregation runs in the DB via `groupBy`
   * (workspace-scoped through the RLS `tx`, role-narrowed like every other
   * dashboard read) and returns only the counts. Shape mirrors the `byStatus` /
   * `byPriority` arrays already produced by `getProjectStatistics` so the
   * frontend can swap the data source without reshaping.
   */
  async getProjectBreakdown(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [byStatus, byPriority] = await Promise.all([
          this.getProjectsByStatus(tx, user),
          this.getProjectsByPriority(tx, user),
        ]);

        return { byStatus, byPriority };
      },
      workspaceId,
    );
  }

  async getProjectStatistics(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [byStatus, byPriority, recentProjects] = await Promise.all([
          this.getProjectsByStatus(tx, user),
          this.getProjectsByPriority(tx, user),
          this.getRecentProjects(tx, 10, user),
        ]);

        return {
          byStatus,
          byPriority,
          recentProjects,
        };
      },
      workspaceId,
    );
  }

  /**
   * Helper: runs through the caller's workspace `tx`. Callers must already be
   * inside a runForUser callback (see getProjectStatistics).
   */
  async getProjectsByStatus(tx: WorkspaceTxClient, user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    const stats = await tx.project.groupBy({
      by: ['status'],
      where: roleWhere,
      _count: true,
    });

    return stats.map((stat) => ({
      status: stat.status,
      count: stat._count,
    }));
  }

  /**
   * Helper: runs through the caller's workspace `tx`. Callers must already be
   * inside a runForUser callback (see getProjectStatistics).
   */
  async getProjectsByPriority(tx: WorkspaceTxClient, user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    const stats = await tx.project.groupBy({
      by: ['priority'],
      where: roleWhere,
      _count: true,
    });

    return stats.map((stat) => ({
      priority: stat.priority,
      count: stat._count,
    }));
  }

  /**
   * Helper: runs through the caller's workspace `tx`. Callers must already be
   * inside a runForUser callback (see getProjectStatistics).
   */
  async getRecentProjects(tx: WorkspaceTxClient, limit: number = 10, user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);

    return tx.project.findMany({
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

  async getUpcomingDueDates(workspaceId: string, days: number = 7, user: User) {
    const roleWhere = this.buildRoleBasedWhere(user);
    const today = new Date();
    const futureDate = new Date();
    futureDate.setDate(today.getDate() + days);

    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.project.findMany({
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
        }),
      workspaceId,
    );
  }

  async getUserActivity(workspaceId: string, user: User) {
    const userId = user.id;
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [createdProjects, assignedProjects, comments, documents] = await Promise.all([
          tx.project.count({ where: { createdById: userId } }),
          tx.project.count({ where: { assignedToId: userId } }),
          tx.comment.count({ where: { authorId: userId } }),
          tx.document.count({ where: { uploadedById: userId } }),
        ]);

        return {
          createdProjects,
          assignedProjects,
          comments,
          documents,
        };
      },
      workspaceId,
    );
  }

  async getRecentActivity(workspaceId: string, user: User, limit: number = 20) {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.auditLog.findMany({
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
        }),
      workspaceId,
    );
  }

  async getMonthlyStats(workspaceId: string, user: User, year: number, month: number) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [projectsCreated, projectsCompleted, documentsUploaded, commentsPosted] =
          await Promise.all([
            tx.project.count({
              where: {
                createdAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            }),
            tx.project.count({
              where: {
                completedAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            }),
            tx.document.count({
              where: {
                uploadedAt: {
                  gte: startDate,
                  lte: endDate,
                },
              },
            }),
            tx.comment.count({
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
      },
      workspaceId,
    );
  }

  /**
   * Build where clause based on user role for row-level security.
   *
   * This is RBAC, NOT workspace tenancy: it narrows by the acting user's role
   * (CLIENT sees own-created, STAFF sees assigned, ADMIN/MANAGER see all) WITHIN
   * the workspace the RLS GUC has already fenced. Left as is per the blueprint.
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
