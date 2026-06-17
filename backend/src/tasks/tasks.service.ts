import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { EmailService } from '../email/email.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto';
import { CreateTaskDependencyDto, DependencyDirection } from './dto/create-task-dependency.dto';
import { TaskSortBy, TaskSortDir } from './dto/query-tasks.dto';
import { clampLimit, clampOffset } from '../common/pagination/clamp';
import {
  TaskStatus,
  TaskPriority,
  TaskDependencyType,
  UserRole,
  User,
  Prisma,
} from '@prisma/client';

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
    private eventEmitter: EventEmitter2,
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

    // Verify parent task if creating a subtask. The read runs inside the
    // workspace RLS tx, so a parent in another workspace is simply invisible
    // here (resolves to not-found) — that enforces same-workspace. We then
    // explicitly require the SAME project (subtasks don't cross projects).
    if (createTaskDto.parentTaskId) {
      const parent = await tx.task.findUnique({
        where: { id: createTaskDto.parentTaskId },
        select: { id: true, projectId: true },
      });

      if (!parent) {
        throw new NotFoundException(`Parent task with ID ${createTaskDto.parentTaskId} not found`);
      }

      if (parent.projectId !== createTaskDto.projectId) {
        throw new BadRequestException('Parent task must belong to the same project as the subtask');
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
   * Map the validated (sortBy, sortDir) into a Prisma orderBy. When the caller
   * supplies an explicit sort we honor it (with a stable `id` tiebreaker);
   * otherwise we keep the historical default (priority desc, dueDate asc,
   * createdAt desc) so existing list behavior is unchanged. `priority`/`status`
   * are enums, sorted by their schema-declared order — so priority `desc` puts
   * URGENT first, which is the intuitive "most important first".
   */
  private buildOrderBy(
    sortBy?: TaskSortBy,
    sortDir?: TaskSortDir,
  ): Prisma.TaskOrderByWithRelationInput[] {
    if (!sortBy) {
      return [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }];
    }
    const dir: Prisma.SortOrder = sortDir === TaskSortDir.asc ? 'asc' : 'desc';
    return [{ [sortBy]: dir }, { id: 'asc' }];
  }

  /**
   * Find all tasks with optional filters, free-text search, due-date window and
   * sort. The result rows carry a `_count.subtasks` (and `_count.comments`) so
   * the UI can show counts without an N+1 follow-up query. `take` is clamped to
   * a max of 100 (audit cap); the controller normally clamps it too, but this
   * defends any other caller.
   */
  async findAll(
    workspaceId: string,
    user: User,
    params: {
      projectId?: string;
      assignedToId?: string;
      createdById?: string;
      parentTaskId?: string;
      status?: TaskStatus;
      priority?: TaskPriority;
      search?: string;
      dueBefore?: string;
      dueAfter?: string;
      sortBy?: TaskSortBy;
      sortDir?: TaskSortDir;
      skip?: number;
      take?: number;
    },
  ) {
    const {
      projectId,
      assignedToId,
      createdById,
      parentTaskId,
      status,
      priority,
      search,
      dueBefore,
      dueAfter,
      sortBy,
      sortDir,
    } = params;

    const take = clampLimit(params.take, 50);
    const skip = clampOffset(params.skip);

    const where: Prisma.TaskWhereInput = {};
    if (projectId) where.projectId = projectId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (createdById) where.createdById = createdById;
    if (parentTaskId) where.parentTaskId = parentTaskId;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    // Case-insensitive substring (ILIKE) over title OR description.
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Due-date window [dueAfter, dueBefore). Tasks with a null dueDate are
    // naturally excluded once either bound is set (Prisma filters them out).
    if (dueBefore || dueAfter) {
      where.dueDate = {};
      if (dueBefore) where.dueDate.lt = new Date(dueBefore);
      if (dueAfter) where.dueDate.gte = new Date(dueAfter);
    }

    const orderBy = this.buildOrderBy(sortBy, sortDir);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [tasks, total] = await Promise.all([
          tx.task.findMany({
            where,
            skip,
            take,
            orderBy,
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
                  subtasks: true,
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
          this.logger.warn(`Failed to send task-assigned email for task ${id}: ${err.message}`),
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
   * Add a comment to a task. After the row is committed we emit the
   * `task.comment.created` domain event so another module (notifications) can
   * fan out @mentions. The emit is OUTSIDE the workspace tx so a listener that
   * re-queries the DB sees a committed row and a slow/failing listener can never
   * hold or roll back the comment write. We do NOT implement notifications here.
   */
  async addComment(
    workspaceId: string,
    user: User,
    taskId: string,
    createCommentDto: CreateTaskCommentDto,
  ) {
    const comment = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
        });

        if (!task) {
          throw new NotFoundException(`Task with ID ${taskId} not found`);
        }

        const created = await tx.taskComment.create({
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
        return created;
      },
      workspaceId,
    );

    // Domain event for downstream @mention fan-out (notifications module).
    this.eventEmitter.emit('task.comment.created', {
      workspaceId,
      taskId,
      commentId: comment.id,
      authorId: user.id,
      content: comment.content,
    });

    return comment;
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
          orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
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
          orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
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
          orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
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

  // ───────────────────────────────────────────────────────────────────────
  // Subtasks
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Get the direct subtasks of a task. 404s if the parent task isn't visible in
   * the active workspace. Each subtask carries `_count.subtasks`/`_count.comments`
   * so the UI can render nested counts without an N+1 follow-up.
   */
  async getSubtasks(workspaceId: string, user: User, parentTaskId: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const parent = await tx.task.findUnique({
          where: { id: parentTaskId },
          select: { id: true },
        });
        if (!parent) {
          throw new NotFoundException(`Task with ID ${parentTaskId} not found`);
        }

        return tx.task.findMany({
          where: { parentTaskId },
          orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
          include: {
            assignedTo: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
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
                subtasks: true,
              },
            },
          },
        });
      },
      workspaceId,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Dependencies
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Resolve (predecessorId, successorId) from the URL task `:id` + the body's
   * direction. Semantics: successor depends on predecessor.
   *   DEPENDS_ON → the URL task depends on the other task (other = predecessor).
   *   BLOCKS     → the URL task blocks the other task (URL task = predecessor).
   */
  private resolveDependencyEdge(
    taskId: string,
    otherTaskId: string,
    direction: DependencyDirection = DependencyDirection.DEPENDS_ON,
  ): { predecessorId: string; successorId: string } {
    if (direction === DependencyDirection.BLOCKS) {
      return { predecessorId: taskId, successorId: otherTaskId };
    }
    return { predecessorId: otherTaskId, successorId: taskId };
  }

  /**
   * Would adding the edge `predecessorId → successorId` (successor depends on
   * predecessor) create a cycle? It does iff the predecessor is ALREADY
   * (transitively) dependent on the successor — i.e. starting at `predecessorId`
   * and walking the "depends on" direction (successor → its predecessors) we can
   * reach `successorId`. A self-edge (predecessor === successor) is the trivial
   * cycle. The walk runs inside the caller's workspace tx, so it only ever sees
   * this workspace's edges.
   */
  private async wouldCreateCycle(
    tx: WorkspaceTxClient,
    predecessorId: string,
    successorId: string,
  ): Promise<boolean> {
    if (predecessorId === successorId) {
      return true;
    }

    // BFS over the dependency graph following "what does X depend on": for a
    // node X (a successor), its parents are the predecessors of edges where
    // successorId === X. If we reach `successorId` from `predecessorId`, the new
    // edge closes a loop.
    const visited = new Set<string>();
    let frontier: string[] = [predecessorId];

    while (frontier.length > 0) {
      const edges = await tx.taskDependency.findMany({
        where: { successorId: { in: frontier } },
        select: { predecessorId: true },
      });

      const next: string[] = [];
      for (const edge of edges) {
        const dep = edge.predecessorId;
        if (dep === successorId) {
          return true;
        }
        if (!visited.has(dep)) {
          visited.add(dep);
          next.push(dep);
        }
      }
      frontier = next;
    }

    return false;
  }

  /**
   * Create a dependency between the URL task `:id` and another task. Stamps
   * workspaceId + createdById from context, requires BOTH tasks to be visible in
   * the active workspace (RLS scopes the reads), rejects self-dependency, and
   * walks the graph to reject any edge that would create a cycle. The
   * unique(predecessorId, successorId) is respected — a duplicate edge surfaces
   * as a 400 rather than a raw Prisma error.
   */
  async addDependency(
    workspaceId: string,
    user: User,
    taskId: string,
    dto: CreateTaskDependencyDto,
  ) {
    const { predecessorId, successorId } = this.resolveDependencyEdge(
      taskId,
      dto.taskId,
      dto.direction,
    );

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Both endpoints must exist in this workspace (RLS fences the reads).
        const [predecessor, successor] = await Promise.all([
          tx.task.findUnique({ where: { id: predecessorId }, select: { id: true } }),
          tx.task.findUnique({ where: { id: successorId }, select: { id: true } }),
        ]);
        if (!predecessor) {
          throw new NotFoundException(`Task with ID ${predecessorId} not found`);
        }
        if (!successor) {
          throw new NotFoundException(`Task with ID ${successorId} not found`);
        }

        if (predecessorId === successorId) {
          throw new BadRequestException('A task cannot depend on itself');
        }

        if (await this.wouldCreateCycle(tx, predecessorId, successorId)) {
          throw new BadRequestException('This dependency would create a cycle in the task graph');
        }

        try {
          return await tx.taskDependency.create({
            data: {
              workspaceId,
              predecessorId,
              successorId,
              type: dto.type ?? TaskDependencyType.FINISH_TO_START,
              createdById: user.id,
            },
            include: {
              predecessor: {
                select: { id: true, title: true, status: true, projectId: true },
              },
              successor: {
                select: { id: true, title: true, status: true, projectId: true },
              },
            },
          });
        } catch (e) {
          // Unique(predecessorId, successorId) violation → the edge already exists.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new BadRequestException('This dependency already exists between these two tasks');
          }
          throw e;
        }
      },
      workspaceId,
    );
  }

  /**
   * Delete a dependency by its id. The dependency must belong to the URL task
   * `:id` (as predecessor or successor) so the route is self-consistent; RLS
   * additionally fences it to the active workspace.
   */
  async removeDependency(workspaceId: string, user: User, taskId: string, dependencyId: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const dep = await tx.taskDependency.findUnique({
          where: { id: dependencyId },
          select: { id: true, predecessorId: true, successorId: true },
        });

        if (!dep) {
          throw new NotFoundException(`Dependency with ID ${dependencyId} not found`);
        }

        if (dep.predecessorId !== taskId && dep.successorId !== taskId) {
          throw new NotFoundException(
            `Dependency ${dependencyId} does not belong to task ${taskId}`,
          );
        }

        await tx.taskDependency.delete({ where: { id: dependencyId } });
        this.logger.log(
          `Dependency ${dependencyId} removed from task ${taskId} by user ${user.id}`,
        );
        return { message: 'Dependency deleted successfully' };
      },
      workspaceId,
    );
  }

  /**
   * Get a task's dependencies in BOTH directions:
   *   dependsOn — edges where this task is the SUCCESSOR (the predecessors it
   *               waits on), with the predecessor task summary.
   *   blocks    — edges where this task is the PREDECESSOR (the successors
   *               waiting on it), with the successor task summary.
   */
  async getDependencies(workspaceId: string, user: User, taskId: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const task = await tx.task.findUnique({
          where: { id: taskId },
          select: { id: true },
        });
        if (!task) {
          throw new NotFoundException(`Task with ID ${taskId} not found`);
        }

        const taskSummary = {
          id: true,
          title: true,
          status: true,
          priority: true,
          projectId: true,
        } as const;

        const [dependsOn, blocks] = await Promise.all([
          tx.taskDependency.findMany({
            where: { successorId: taskId },
            orderBy: { createdAt: 'asc' },
            include: { predecessor: { select: taskSummary } },
          }),
          tx.taskDependency.findMany({
            where: { predecessorId: taskId },
            orderBy: { createdAt: 'asc' },
            include: { successor: { select: taskSummary } },
          }),
        ]);

        return { dependsOn, blocks };
      },
      workspaceId,
    );
  }
}
