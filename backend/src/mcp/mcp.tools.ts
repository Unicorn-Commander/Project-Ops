/**
 * Tool implementations for the Project Ops MCP server.
 *
 * Each tool is a thin async function that runs as the *calling user*: the
 * controller pulls the user out of the JWT and passes it in. Permissions are
 * enforced by the same role logic the REST API uses, so an agent can never
 * see anything its user wouldn't.
 */

import { PrismaService } from '../prisma/prisma.service';
import { Prisma, User, UserRole } from '@prisma/client';

type Logger = { log: (msg: string) => void; warn: (msg: string) => void };

function buildVisibilityFilter(user: User): Prisma.ProjectWhereInput {
  if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
    return {};
  }
  if (user.role === UserRole.STAFF) {
    return {
      OR: [{ assignedToId: user.id }, { createdById: user.id }],
    };
  }
  // CLIENT — only projects they're a contact on
  return {
    OR: [{ contactId: user.id }, { contact: { userId: user.id } }],
  };
}

export class ProjectOpsTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: Logger = console,
  ) {}

  async listMyProjects(
    user: User,
    args: { status?: string; limit?: number },
  ) {
    const where: Prisma.ProjectWhereInput = {
      ...buildVisibilityFilter(user),
      ...(args.status ? { status: args.status as any } : {}),
    };
    const projects = await this.prisma.project.findMany({
      where,
      take: Math.min(args.limit ?? 25, 100),
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectNumber: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        clientName: true,
        organization: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });
    return { projects, count: projects.length };
  }

  async getProject(user: User, args: { id?: string; projectNumber?: string }) {
    if (!args.id && !args.projectNumber) {
      throw new Error('Either id or projectNumber must be provided');
    }
    const project = await this.prisma.project.findFirst({
      where: {
        ...buildVisibilityFilter(user),
        ...(args.id ? { id: args.id } : { projectNumber: args.projectNumber! }),
      },
      include: {
        organization: { select: { id: true, name: true, type: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 25,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            dueDate: true,
            assignedTo: { select: { firstName: true, lastName: true } },
          },
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            content: true,
            createdAt: true,
            author: { select: { firstName: true, lastName: true } },
          },
        },
        _count: { select: { tasks: true, comments: true, documents: true } },
      },
    });
    if (!project) {
      throw new Error(`Project not found or you don't have access`);
    }
    return project;
  }

  async listMyTasks(
    user: User,
    args: { status?: string; limit?: number },
  ) {
    const tasks = await this.prisma.task.findMany({
      where: {
        assignedToId: user.id,
        ...(args.status ? { status: args.status as any } : {}),
      },
      take: Math.min(args.limit ?? 25, 100),
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        type: true,
        project: {
          select: { id: true, projectNumber: true, title: true },
        },
      },
    });
    return { tasks, count: tasks.length };
  }

  async searchProjects(user: User, args: { query: string; limit?: number }) {
    const q = (args.query ?? '').trim();
    if (!q) {
      throw new Error('query is required');
    }
    const projects = await this.prisma.project.findMany({
      where: {
        ...buildVisibilityFilter(user),
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { projectNumber: { contains: q, mode: 'insensitive' } },
          { clientName: { contains: q, mode: 'insensitive' } },
          { organization: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      take: Math.min(args.limit ?? 10, 50),
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        projectNumber: true,
        title: true,
        status: true,
        clientName: true,
        organization: { select: { name: true } },
      },
    });
    return { projects, count: projects.length };
  }

  async getRecentActivity(user: User, args: { limit?: number }) {
    const visibility = buildVisibilityFilter(user);
    const limit = Math.min(args.limit ?? 20, 50);
    const [comments, taskUpdates] = await Promise.all([
      this.prisma.comment.findMany({
        where: { project: visibility },
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          content: true,
          createdAt: true,
          author: { select: { firstName: true, lastName: true } },
          project: { select: { id: true, projectNumber: true, title: true } },
        },
      }),
      this.prisma.task.findMany({
        where: { project: visibility },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          project: { select: { id: true, projectNumber: true, title: true } },
          assignedTo: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);
    return { recent_comments: comments, recent_task_updates: taskUpdates };
  }

  async addTaskComment(
    user: User,
    args: { taskId: string; content: string },
  ) {
    const task = await this.prisma.task.findFirst({
      where: {
        id: args.taskId,
        project: buildVisibilityFilter(user),
      },
      select: { id: true, projectId: true },
    });
    if (!task) {
      throw new Error("Task not found or you don't have access");
    }
    const comment = await this.prisma.taskComment.create({
      data: {
        taskId: task.id,
        authorId: user.id,
        content: args.content,
      },
      select: {
        id: true,
        content: true,
        createdAt: true,
        author: { select: { firstName: true, lastName: true } },
      },
    });
    this.logger.log(`MCP add_task_comment: user=${user.email} task=${task.id}`);
    return comment;
  }
}
