import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { EmailService } from '../email/email.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto';
import { TaskStatus, TaskPriority, UserRole, User } from '@prisma/client';

/**
 * SUITE TENANCY (Phase 2, B2): Task + TaskComment are RLS-scoped tables, so
 * EVERY read/write runs inside `WorkspaceContextService.runForUser(user, tx =>
 * ..., workspaceId)`. All task-owned DB access goes through the passed `tx`,
 * never `this.prisma` — that is what scopes the GUC to the active workspace.
 * Side effects that are NOT DB access (the assignment email) stay OUTSIDE the
 * tx so a slow/failing mail send never holds or rolls back the transaction.
 * Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off (membership
 * resolution is a no-op and withWorkspace runs under the BYPASSRLS owner
 * connection).
 *
 * `createInTx(tx, workspaceId, user, dto)` exposes the creation logic so other
 * modules (the triage agent) can create a Task inside their OWN workspace tx,
 * in one transaction and one membership authorization.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private workspaceContext: WorkspaceContextService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  /**
   * Create a task INSIDE an existing workspace tx. Shared by the public
   * `create` and by other modules (triage) that already hold a workspace-scoped
   * transaction, so the Task is created in the same tx + membership auth as the
   * caller. The Task is stamped with the active `workspaceId`.
   */
  async createInTx(
    tx: WorkspaceTxClient,
    workspaceId: string,
    user: User,
    createTaskDto: CreateTaskDto,
  ) {
    this.logger.log(
      `Creating task for project ${createTaskDto.projectId} by user ${user.id} ws=${workspaceId}`,
    );

    // Verify project exists (within the workspace tx)
    const projectExists = await tx.project.findUnique({
      where: { id: createTaskDto.projectId },
    });

    if (!projectExists) {
      throw new NotFoundException(`Project with ID ${createTaskDto.projectId} not found`);
    }

    // Verify assignee exists if provided
    if (createTaskDto.assignedToId) {
      const assigneeExists = await tx.user.findUnique({
        where: { id: createTaskDto.assignedToId },
      });

      if (!assigneeExists) {
        throw new NotFoundException(`User with ID ${createTaskDto.assignedToId} not found`);
      }
    }

    const task = await tx.task.create({
      data: {
        ...createTaskDto,
        workspaceId,
        createdById: user.id,
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
   * Create a new task. Runs inside the acting user's workspace RLS transaction.
   */
  async create(workspaceId: string, user: User, createTaskDto: CreateTaskDto) {
    return this.workspaceContext.runForUser(
      user,
      (tx) => this.createInTx(tx, workspaceId, user, createTaskDto),
      workspaceId,
    );
  }

  /**
   * Find all tasks with optional filters
   */
  async findAll(
    workspaceId: string,
    user: User,
    params: {
      projectId?: string;
      assignedToId?: string;
      createdById?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      skip?: number;
      take?: number;
    },
  ) {
    const { projectId, assignedToId, createdById, status, priority, skip = 0, take = 50 } = params;

    const where: any = {};
    if (projectId) where.projectId = projectId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (createdById) where.createdById = createdById;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [tasks, total] = await Promise.all([
          tx.task.findMany({
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
          tx.task.count({ where }),
        ]);

        return {
          data: tasks,
          total,
          skip,
          take,
        };
      },
      workspaceId,
    );
  }

  /**
   * Find one task by ID
   */
  async findOne(workspaceId: string, user: User, id: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
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
      },
      workspaceId,
    );
  }

  /**
   * Update a task
   */
  async update(
    workspaceId: string,
    user: User,
    id: string,
    updateTaskDto: UpdateTaskDto,
    userRole: UserRole,
  ) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${id} not found`);
        }

        // Only creator, assignee, or admin can update
        const canUpdate =
          task.createdById === user.id ||
          task.assignedToId === user.id ||
          userRole === UserRole.ADMIN ||
          userRole === UserRole.MANAGER;

        if (!canUpdate) {
          throw new ForbiddenException('You do not have permission to update this task');
        }

        // Verify assignee exists if being updated
        if (updateTaskDto.assignedToId) {
          const assigneeExists = await tx.user.findUnique({
            where: { id: updateTaskDto.assignedToId },
          });

          if (!assigneeExists) {
            throw new NotFoundException(`User with ID ${updateTaskDto.assignedToId} not found`);
          }
        }

        const updatedTask = await tx.task.update({
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

        this.logger.log(`Task ${id} updated by user ${user.id}`);
        return updatedTask;
      },
      workspaceId,
    );
  }

  /**
   * Update task status
   */
  async updateStatus(workspaceId: string, user: User, id: string, status: TaskStatus) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${id} not found`);
        }

        const updatedTask = await tx.task.update({
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
      },
      workspaceId,
    );
  }

  /**
   * Assign task to a user. The assignment email is sent OUTSIDE the workspace
   * tx (a slow/failing mail send must never hold or roll back the DB write).
   */
  async assignTask(workspaceId: string, user: User, id: string, assignedToId: string) {
    const updatedTask = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${id} not found`);
        }

        // Verify assignee exists
        const assignee = await tx.user.findUnique({
          where: { id: assignedToId },
        });

        if (!assignee) {
          throw new NotFoundException(`User with ID ${assignedToId} not found`);
        }

        const result = await tx.task.update({
          where: { id },
          data: { assignedToId },
          include: {
            project: true,
            assignedTo: true,
            createdBy: true,
          },
        });

        this.logger.log(`Task ${id} assigned to user ${assignedToId}`);
        return result;
      },
      workspaceId,
    );

    // Side effect OUTSIDE the tx: notify the new assignee.
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
  async markComplete(workspaceId: string, user: User, id: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${id} not found`);
        }

        const updatedTask = await tx.task.update({
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

        this.logger.log(`Task ${id} marked as completed by user ${user.id}`);
        return updatedTask;
      },
      workspaceId,
    );
  }

  /**
   * Delete a task (admin only)
   */
  async remove(workspaceId: string, user: User, id: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${id} not found`);
        }

        await tx.task.delete({
          where: { id },
        });

        this.logger.log(`Task ${id} deleted`);
        return { message: 'Task deleted successfully' };
      },
      workspaceId,
    );
  }

  /**
   * Add a comment to a task
   */
  async addComment(
    workspaceId: string,
    user: User,
    taskId: string,
    createCommentDto: CreateTaskCommentDto,
  ) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${taskId} not found`);
        }

        const comment = await tx.taskComment.create({
          data: {
            taskId,
            workspaceId,
            authorId: user.id,
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

        this.logger.log(`Comment added to task ${taskId} by user ${user.id}`);
        return comment;
      },
      workspaceId,
    );
  }

  /**
   * Get all comments for a task
   */
  async getTaskComments(workspaceId: string, user: User, taskId: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${taskId} not found`);
        }

        return tx.taskComment.findMany({
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
      },
      workspaceId,
    );
  }

  /**
   * Get all tasks for a specific project
   */
  async getProjectTasks(workspaceId: string, user: User, projectId: string) {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.task.findMany({
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
        }),
      workspaceId,
    );
  }

  /**
   * Get all tasks assigned to a specific user
   */
  async getUserTasks(workspaceId: string, user: User, userId: string) {
    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.task.findMany({
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
        }),
      workspaceId,
    );
  }

  /**
   * Get all overdue tasks
   */
  async getOverdueTasks(workspaceId: string, user: User) {
    const now = new Date();

    return this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.task.findMany({
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
        }),
      workspaceId,
    );
  }
}
