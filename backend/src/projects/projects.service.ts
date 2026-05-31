import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { Project, Prisma, ProjectStatus, User, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
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

  async create(createProjectDto: CreateProjectDto, userId: string): Promise<Project> {
    const projectNumber = await this.generateProjectNumber();

    // Extract projectType from DTO (it's not a direct Prisma field)
    const { projectType, ...projectDataFields } = createProjectDto;

    // Prepare metadata with projectType if provided
    const metadata = projectType
      ? { ...createProjectDto.metadata, projectType }
      : createProjectDto.metadata;

    const projectData = await this.prisma.project.create({
      data: {
        ...this.coerceDateFields(projectDataFields),
        metadata,
        projectNumber,
        createdById: userId,
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
      userId,
      projectId: projectData.id,
      action: 'CREATE',
      resource: 'Project',
      resourceId: projectData.id,
      details: { projectNumber: projectData.projectNumber },
    });

    this.logger.log(`Project created: ${projectData.projectNumber} by user ${userId}`);
    return projectData;
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.ProjectWhereInput;
    orderBy?: Prisma.ProjectOrderByWithRelationInput;
  }): Promise<{ projects: Project[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
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
      this.prisma.project.count({ where }),
    ]);

    return { projects, total };
  }

  async findOne(id: string): Promise<Project> {
    const projectData = await this.prisma.project.findUnique({
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
  }

  async findByProjectNumber(projectNumber: string): Promise<Project> {
    const projectData = await this.prisma.project.findUnique({
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
  }

  async update(id: string, updateProjectDto: UpdateProjectDto, userId: string): Promise<Project> {
    // Extract projectType from DTO (it's not a direct Prisma field)
    const { projectType, ...projectDataFields } = updateProjectDto;

    // If projectType is being updated, merge it into metadata
    const metadata = projectType !== undefined
      ? { ...updateProjectDto.metadata, projectType }
      : updateProjectDto.metadata;

    const projectData = await this.prisma.project.update({
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
      userId,
      projectId: id,
      action: 'UPDATE',
      resource: 'Project',
      resourceId: id,
      details: updateProjectDto,
    });

    this.logger.log(`Project updated: ${projectData.projectNumber} by user ${userId}`);
    return projectData;
  }

  async updateStatus(id: string, status: ProjectStatus, userId: string): Promise<Project> {
    const updateData: any = { status };

    if (status === ProjectStatus.COMPLETED) {
      updateData.completedAt = new Date();
    }

    const projectData = await this.prisma.project.update({
      where: { id },
      data: updateData,
      include: {
        createdBy: true,
        assignedTo: true,
      },
    });

    await this.auditService.log({
      userId,
      projectId: id,
      action: 'UPDATE',
      resource: 'Project',
      resourceId: id,
      details: { status, previousStatus: projectData.status },
    });

    this.logger.log(`Project status updated: ${projectData.projectNumber} to ${status}`);
    return projectData;
  }

  async assignProject(id: string, assignProjectDto: AssignProjectDto, userId: string): Promise<Project> {
    const projectData = await this.prisma.project.update({
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
      userId,
      projectId: id,
      action: 'UPDATE',
      resource: 'Project',
      resourceId: id,
      details: { assignedTo: assignProjectDto.assignedToId },
    });

    this.logger.log(`Project assigned: ${projectData.projectNumber} to user ${assignProjectDto.assignedToId}`);
    return projectData;
  }

  async remove(id: string, userId: string): Promise<Project> {
    const projectData = await this.prisma.project.delete({
      where: { id },
    });

    await this.auditService.log({
      userId,
      projectId: id,
      action: 'DELETE',
      resource: 'Project',
      resourceId: id,
      details: { projectNumber: projectData.projectNumber },
    });

    this.logger.log(`Project deleted: ${projectData.projectNumber} by user ${userId}`);
    return projectData;
  }

  private async generateProjectNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.project.count({
      where: {
        createdAt: {
          gte: new Date(`${year}-01-01`),
        },
      },
    });

    const sequence = (count + 1).toString().padStart(6, '0');
    return `PROJ-${year}-${sequence}`;
  }

  async getStatsByStatus(user: User): Promise<any> {
    const where = this.buildRoleBasedWhere(user);

    const stats = await this.prisma.project.groupBy({
      by: ['status'],
      where,
      _count: true,
    });

    return stats.reduce((acc, stat) => {
      acc[stat.status] = stat._count;
      return acc;
    }, {});
  }

  async getStatsByPriority(user: User): Promise<any> {
    const where = this.buildRoleBasedWhere(user);

    const stats = await this.prisma.project.groupBy({
      by: ['priority'],
      where,
      _count: true,
    });

    return stats.reduce((acc, stat) => {
      acc[stat.priority] = stat._count;
      return acc;
    }, {});
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
