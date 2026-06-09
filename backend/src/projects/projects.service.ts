import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { Project, Prisma, ProjectStatus, User, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

/**
 * SUITE TENANCY (Phase 2, B1): every project read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. All project DB access goes through
 * the passed `tx`, never `this.prisma`, or it bypasses the GUC chokepoint.
 * `workspaceId` is stamped onto every created Project and carried into every
 * `audit.log()` call. Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off
 * (membership resolution is a no-op and withWorkspace runs under the BYPASSRLS
 * owner connection).
 *
 * Both `findOne` and `findByProjectNumber` are workspace-scoped (blueprint R1,
 * approved): a project from another workspace 404s rather than leaking, which
 * is the fail-closed behavior once RLS is live.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  /**
   * Coerce ISO date *strings* (e.g. "2026-06-01" from an <input type="date">)
   * into Date objects before they reach Prisma. The DTOs validate these with
   * @IsDateString(), which accepts date-only strings, but Prisma's DateTime
   * columns reject a string without a time component and throw a 500. Convert
   * any present date field to a real Date so every write path is safe.
   */
  private coerceDateFields<T extends Record<string, any>>(data: T): T {
    const dateFields = [
      'dueDate',
      'billingDate',
      'paymentDueDate',
      'paymentReceivedDate',
    ] as const;
    for (const field of dateFields) {
      const value = data[field];
      if (typeof value === 'string' && value.length > 0) {
        (data as Record<string, any>)[field] = new Date(value);
      }
    }
    return data;
  }

  /**
   * Create a project for the acting user's active workspace. Opens the
   * workspace RLS transaction and delegates to {@link createInTx}, which runs
   * the project-number count + create together inside that single tx.
   */
  async create(
    workspaceId: string,
    user: User,
    createProjectDto: CreateProjectDto,
  ): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      (tx) => this.createInTx(tx, workspaceId, user, createProjectDto),
      workspaceId,
    );
  }

  /**
   * Create a project inside an EXISTING workspace tx. Shared by {@link create}
   * and by other modules (e.g. triage's createProjectFromUnassigned) that
   * already hold a workspace-scoped transaction — calling this instead of
   * `create()` keeps the work in ONE runForUser (one membership authorization,
   * one GUC scope) and avoids a nested transaction.
   *
   * The project-number count runs in the SAME `tx` as the insert so the
   * sequence is computed against the workspace-scoped row set (under live RLS)
   * and is consistent with the row being created.
   */
  async createInTx(
    tx: WorkspaceTxClient,
    workspaceId: string,
    user: User,
    createProjectDto: CreateProjectDto,
  ): Promise<Project> {
    const projectNumber = await this.generateProjectNumber(tx);

    // Extract projectType from DTO (it's not a direct Prisma field)
    const { projectType, ...projectDataFields } = createProjectDto;

    // Prepare metadata with projectType if provided
    const metadata = projectType
      ? { ...createProjectDto.metadata, projectType }
      : createProjectDto.metadata;

    const projectData = await tx.project.create({
      data: {
        ...this.coerceDateFields(projectDataFields),
        metadata,
        projectNumber,
        workspaceId,
        createdById: user.id,
      },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            company: true,
          },
        },
        createdBy: true,
        assignedTo: true,
      },
    });

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      projectId: projectData.id,
      action: 'CREATE',
      resource: 'Project',
      resourceId: projectData.id,
      details: { projectNumber: projectData.projectNumber },
    });

    this.logger.log(
      `Project created: ${projectData.projectNumber} by user ${user.id} ws=${workspaceId}`,
    );
    return projectData;
  }

  async findAll(
    workspaceId: string,
    user: User,
    params?: {
      skip?: number;
      take?: number;
      where?: Prisma.ProjectWhereInput;
      orderBy?: Prisma.ProjectOrderByWithRelationInput;
    },
  ): Promise<{ projects: Project[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [projects, total] = await Promise.all([
          tx.project.findMany({
            skip,
            take,
            where,
            orderBy,
            include: {
              contact: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  phone: true,
                  company: true,
                },
              },
              createdBy: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
              assignedTo: {
                select: {
                  id: true,
                  email: true,
                  firstName: true,
                  lastName: true,
                },
              },
              _count: {
                select: {
                  documents: true,
                  comments: true,
                },
              },
            },
          }),
          tx.project.count({ where }),
        ]);

        return { projects, total };
      },
      workspaceId,
    );
  }

  async findOne(workspaceId: string, user: User, id: string): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.findUnique({
          where: { id },
          include: {
            contact: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                company: true,
              },
            },
            createdBy: true,
            assignedTo: true,
            documents: {
              orderBy: { uploadedAt: 'desc' },
              take: 10,
            },
            comments: {
              orderBy: { createdAt: 'desc' },
              take: 10,
              include: {
                author: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
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

        if (!projectData) {
          throw new NotFoundException(`Project with ID ${id} not found`);
        }

        return projectData;
      },
      workspaceId,
    );
  }

  async findByProjectNumber(
    workspaceId: string,
    user: User,
    projectNumber: string,
  ): Promise<Project> {
    // projectNumber is unique PER WORKSPACE (@@unique([workspaceId,
    // projectNumber])), not globally, so it is no longer a findUnique key.
    // Running inside runForUser pins the workspace RLS GUC, so once tenancy is
    // live this findFirst is fenced to the active workspace; in Phase 1's
    // single bootstrap workspace it returns the same row. Scoped per R1.
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.findFirst({
          where: { projectNumber },
          include: {
            createdBy: true,
            assignedTo: true,
          },
        });

        if (!projectData) {
          throw new NotFoundException(`Project ${projectNumber} not found`);
        }

        return projectData;
      },
      workspaceId,
    );
  }

  async update(
    workspaceId: string,
    user: User,
    id: string,
    updateProjectDto: UpdateProjectDto,
  ): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Extract projectType from DTO (it's not a direct Prisma field)
        const { projectType, ...projectDataFields } = updateProjectDto;

        // If projectType is being updated, merge it into metadata
        const metadata =
          projectType !== undefined
            ? { ...updateProjectDto.metadata, projectType }
            : updateProjectDto.metadata;

        const projectData = await tx.project.update({
          where: { id },
          data: {
            ...this.coerceDateFields(projectDataFields),
            ...(metadata !== undefined && { metadata }),
          },
          include: {
            createdBy: true,
            assignedTo: true,
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'UPDATE',
          resource: 'Project',
          resourceId: id,
          details: updateProjectDto,
        });

        this.logger.log(
          `Project updated: ${projectData.projectNumber} by user ${user.id} ws=${workspaceId}`,
        );
        return projectData;
      },
      workspaceId,
    );
  }

  async updateStatus(
    workspaceId: string,
    user: User,
    id: string,
    status: ProjectStatus,
  ): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const updateData: any = { status };

        if (status === ProjectStatus.COMPLETED) {
          updateData.completedAt = new Date();
        }

        const projectData = await tx.project.update({
          where: { id },
          data: updateData,
          include: {
            createdBy: true,
            assignedTo: true,
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'UPDATE',
          resource: 'Project',
          resourceId: id,
          details: { status, previousStatus: projectData.status },
        });

        this.logger.log(
          `Project status updated: ${projectData.projectNumber} to ${status} ws=${workspaceId}`,
        );
        return projectData;
      },
      workspaceId,
    );
  }

  async assignProject(
    workspaceId: string,
    user: User,
    id: string,
    assignProjectDto: AssignProjectDto,
  ): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.update({
          where: { id },
          data: {
            assignedToId: assignProjectDto.assignedToId,
          },
          include: {
            createdBy: true,
            assignedTo: true,
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'UPDATE',
          resource: 'Project',
          resourceId: id,
          details: { assignedTo: assignProjectDto.assignedToId },
        });

        this.logger.log(
          `Project assigned: ${projectData.projectNumber} to user ${assignProjectDto.assignedToId} ws=${workspaceId}`,
        );
        return projectData;
      },
      workspaceId,
    );
  }

  async remove(workspaceId: string, user: User, id: string): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.delete({
          where: { id },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'DELETE',
          resource: 'Project',
          resourceId: id,
          details: { projectNumber: projectData.projectNumber },
        });

        this.logger.log(
          `Project deleted: ${projectData.projectNumber} by user ${user.id} ws=${workspaceId}`,
        );
        return projectData;
      },
      workspaceId,
    );
  }

  /**
   * Generate the next project number. Runs on the passed workspace `tx` so the
   * count is computed against the workspace-scoped row set (under live RLS) and
   * is consistent with the create it precedes — callers MUST invoke this inside
   * the same runForUser tx as the insert (see {@link createInTx}).
   */
  private async generateProjectNumber(tx: WorkspaceTxClient): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.project.count({
      where: {
        createdAt: {
          gte: new Date(`${year}-01-01`),
        },
      },
    });

    const sequence = (count + 1).toString().padStart(6, '0');
    return `PROJ-${year}-${sequence}`;
  }

  async getStatsByStatus(workspaceId: string, user: User): Promise<any> {
    const where = this.buildRoleBasedWhere(user);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const stats = await tx.project.groupBy({
          by: ['status'],
          where,
          _count: true,
        });

        return stats.reduce((acc, stat) => {
          acc[stat.status] = stat._count;
          return acc;
        }, {});
      },
      workspaceId,
    );
  }

  async getStatsByPriority(workspaceId: string, user: User): Promise<any> {
    const where = this.buildRoleBasedWhere(user);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const stats = await tx.project.groupBy({
          by: ['priority'],
          where,
          _count: true,
        });

        return stats.reduce((acc, stat) => {
          acc[stat.priority] = stat._count;
          return acc;
        }, {});
      },
      workspaceId,
    );
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
