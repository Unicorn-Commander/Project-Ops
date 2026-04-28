import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto';
import { TaskStatus, TaskPriority, UserRole } from '@prisma/client';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  /**
   * Create a new task
   */
  async create(createTaskDto: CreateTaskDto, createdById: string) {
    this.logger.log(`Creating task for project ${createTaskDto.projectId} by user ${createdById}`);

    // Verify project exists
    const projectExists = await this.prisma.project.findUnique({
      where: { id: createTaskDto.projectId },
    });

    if (!projectExists) {
      throw new NotFoundException(`Project with ID ${createTaskDto.projectId} not found`);
    }

    // Verify assignee exists if provided
    if (createTaskDto.assignedToId) {
      const assigneeExists = await this.prisma.user.findUnique({
        where: { id: createTaskDto.assignedToId },
      });

      if (!assigneeExists) {
        throw new NotFoundException(`User with ID ${createTaskDto.assignedToId} not found`);
      }
    }

    const task = await this.prisma.task.create({
      data: {
        ...createTaskDto,
        createdById,
        dueDate: createTaskDto.dueDate ? new Date(createTaskDto.dueDate) : null,
      },
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            title: true,
            status: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    this.logger.log(`Task ${task.id} created successfully`);
    return task;
  }

  /**
   * Find all tasks with optional filters
   */
  async findAll(params: {
    projectId?: string;
    assignedToId?: string;
    createdById?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    skip?: number;
    take?: number;
  }) {
    const { projectId, assignedToId, createdById, status, priority, skip = 0, take = 50 } = params;

    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (createdById) where.createdById = createdById;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [tasks, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        skip,
        take,
        orderBy: [
          { priority: 'desc' },
          { dueDate: 'asc' },
          { createdAt: 'desc' },
        ],
        include: {
          project: {
            select: {
              id: true,
              projectNumber: true,
              title: true,
              status: true,
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
              comments: true,
            },
          },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      data: tasks,
      total,
      skip,
      take,
    };
  }

  /**
   * Find one task by ID
   */
  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            title: true,
            status: true,
            priority: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        comments: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  /**
   * Update a task
   */
  async update(id: string, updateTaskDto: UpdateTaskDto, userId: string, userRole: UserRole) {
    const task = await this.prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    // Only creator, assignee, or admin can update
    const canUpdate =
      task.createdById === userId ||
      task.assignedToId === userId ||
      userRole === UserRole.ADMIN ||
      userRole === UserRole.MANAGER;

    if (!canUpdate) {
      throw new ForbiddenException('You do not have permission to update this task');
    }

    // Verify assignee exists if being updated
    if (updateTaskDto.assignedToId) {
      const assigneeExists = await this.prisma.user.findUnique({
        where: { id: updateTaskDto.assignedToId },
      });

      if (!assigneeExists) {
        throw new NotFoundException(`User with ID ${updateTaskDto.assignedToId} not found`);
      }
    }

    const updatedTask = await this.prisma.task.update({
      where: { id },
      data: {
        ...updateTaskDto,
        dueDate: updateTaskDto.dueDate ? new Date(updateTaskDto.dueDate) : undefined,
      },
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            title: true,
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
      },
    });

    this.logger.log(`Task ${id} updated by user ${userId}`);
    return updatedTask;
  }

  /**
   * Update task status
   */
  async updateStatus(id: string, status: TaskStatus) {
    const task = await this.prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    const updatedTask = await this.prisma.task.update({
      where: { id },
      data: {
        status,
        completedAt: status === TaskStatus.COMPLETED ? new Date() : null,
      },
      include: {
        project: true,
        assignedTo: true,
        createdBy: true,
      },
    });

    this.logger.log(`Task ${id} status updated to ${status}`);
    return updatedTask;
  }

  /**
   * Assign task to a user
   */
  async assignTask(id: string, assignedToId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    // Verify assignee exists
    const assignee = await this.prisma.user.findUnique({
      where: { id: assignedToId },
    });

    if (!assignee) {
      throw new NotFoundException(`User with ID ${assignedToId} not found`);
    }

    const updatedTask = await this.prisma.task.update({
      where: { id },
      data: { assignedToId },
      include: {
        project: true,
        assignedTo: true,
        createdBy: true,
      },
    });

    this.logger.log(`Task ${id} assigned to user ${assignedToId}`);

    if (updatedTask.assignedTo?.email) {
      const frontendUrl = this.configService.get<string>(
        'FRONTEND_URL',
        'https://projectops.magicunicorn.dev',
      );
      const taskUrl = `${frontendUrl}/dashboard/projects/${updatedTask.projectId}?task=${updatedTask.id}`;
      const assignedByName = updatedTask.createdBy
        ? `${updatedTask.createdBy.firstName} ${updatedTask.createdBy.lastName}`.trim()
        : 'Project Ops';
      const dueDate = updatedTask.dueDate
        ? new Date(updatedTask.dueDate).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : null;

      this.emailService
        .sendTaskAssignedEmail(
          updatedTask.assignedTo.email,
          `${updatedTask.assignedTo.firstName} ${updatedTask.assignedTo.lastName}`.trim() ||
            updatedTask.assignedTo.email,
          updatedTask.title,
          updatedTask.project.projectNumber,
          updatedTask.project.title,
          assignedByName,
          dueDate,
          taskUrl,
        )
        .catch((err) =>
          this.logger.warn(
            `Failed to send task-assigned email for task ${id}: ${err.message}`,
          ),
        );
    }

    return updatedTask;
  }

  /**
   * Mark task as completed
   */
  async markComplete(id: string, userId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    const updatedTask = await this.prisma.task.update({
      where: { id },
      data: {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
      },
      include: {
        project: true,
        assignedTo: true,
        createdBy: true,
      },
    });

    this.logger.log(`Task ${id} marked as completed by user ${userId}`);
    return updatedTask;
  }

  /**
   * Delete a task (admin only)
   */
  async remove(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    await this.prisma.task.delete({
      where: { id },
    });

    this.logger.log(`Task ${id} deleted`);
    return { message: 'Task deleted successfully' };
  }

  /**
   * Add a comment to a task
   */
  async addComment(taskId: string, createCommentDto: CreateTaskCommentDto, authorId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    const comment = await this.prisma.taskComment.create({
      data: {
        taskId,
        authorId,
        content: createCommentDto.content,
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    this.logger.log(`Comment added to task ${taskId} by user ${authorId}`);
    return comment;
  }

  /**
   * Get all comments for a task
   */
  async getTaskComments(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    return this.prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });
  }

  /**
   * Get all tasks for a specific project
   */
  async getProjectTasks(projectId: string) {
    return this.prisma.task.findMany({
      where: { projectId },
      orderBy: [
        { priority: 'desc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
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
            comments: true,
          },
        },
      },
    });
  }

  /**
   * Get all tasks assigned to a specific user
   */
  async getUserTasks(userId: string) {
    return this.prisma.task.findMany({
      where: { assignedToId: userId },
      orderBy: [
        { priority: 'desc' },
        { dueDate: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            title: true,
            status: true,
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
        _count: {
          select: {
            comments: true,
          },
        },
      },
    });
  }

  /**
   * Get all overdue tasks
   */
  async getOverdueTasks() {
    const now = new Date();

    return this.prisma.task.findMany({
      where: {
        dueDate: {
          lt: now,
        },
        status: {
          notIn: [TaskStatus.COMPLETED, TaskStatus.CANCELLED],
        },
      },
      orderBy: [
        { priority: 'desc' },
        { dueDate: 'asc' },
      ],
      include: {
        project: {
          select: {
            id: true,
            projectNumber: true,
            title: true,
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
      },
    });
  }
}
