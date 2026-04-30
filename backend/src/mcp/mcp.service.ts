/**
 * Builds a per-request MCP server scoped to one authenticated user.
 *
 * Brigade (or any MCP client) opens a Streamable HTTP session against
 * /api/v1/mcp. For each request we mint a fresh McpServer + transport,
 * register the Project Ops tool set, and let the SDK handle the protocol.
 *
 * The user is captured by closure on the tool handlers, so all data access
 * runs with their identity / RBAC.
 */

import { Injectable, Logger } from '@nestjs/common';
import { User } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectOpsTools } from './mcp.tools';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build a fresh MCP server bound to one authenticated user.
   * Returns the server instance; caller connects a transport to it.
   *
   * Imports the SDK lazily to keep the cold-start path simple — the SDK ships
   * dual CJS/ESM and `require()` resolution into the cjs/ folder is fine, but
   * we still pay the resolve cost only when MCP is actually called.
   */
  async createServerForUser(user: User) {
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');

    const server = new McpServer(
      {
        name: 'project-ops',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
        instructions:
          'Project Ops MCP server. Tools let an agent read projects, tasks, ' +
          'and recent activity for the calling user, and post task comments. ' +
          'All operations enforce the same RBAC as the Project Ops UI.',
      },
    );

    const tools = new ProjectOpsTools(this.prisma, this.logger);

    server.registerTool(
      'list_my_projects',
      {
        title: 'List my projects',
        description:
          "Return the projects the calling user can see, newest first. " +
          "Optional 'status' filters by ProjectStatus (NEW, IN_PROGRESS, " +
          "UNDER_REVIEW, COMPLETED, ARCHIVED, ON_HOLD).",
        inputSchema: {
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: { status?: string; limit?: number }) =>
        wrap(await tools.listMyProjects(user, args)),
    );

    server.registerTool(
      'get_project',
      {
        title: 'Get a project by id or projectNumber',
        description:
          'Return full detail for a single project the user can see, ' +
          'including recent tasks and comments.',
        inputSchema: {
          id: z.string().optional(),
          projectNumber: z.string().optional(),
        },
      },
      async (args: { id?: string; projectNumber?: string }) =>
        wrap(await tools.getProject(user, args)),
    );

    server.registerTool(
      'list_my_tasks',
      {
        title: 'List tasks assigned to me',
        description:
          'Return tasks assigned to the calling user, sorted by due date. ' +
          "Optional 'status' filters by TaskStatus.",
        inputSchema: {
          status: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: { status?: string; limit?: number }) =>
        wrap(await tools.listMyTasks(user, args)),
    );

    server.registerTool(
      'search_projects',
      {
        title: 'Search projects',
        description:
          'Free-text search across visible projects (title, description, ' +
          'project number, client name, organization name).',
        inputSchema: {
          query: z.string().min(1),
          limit: z.number().int().min(1).max(50).optional(),
        },
      },
      async (args: { query: string; limit?: number }) =>
        wrap(await tools.searchProjects(user, args)),
    );

    server.registerTool(
      'get_recent_activity',
      {
        title: 'Get recent activity',
        description:
          'Return recent comments and task updates across the projects the ' +
          'user can see — useful for "what changed today?" questions.',
        inputSchema: {
          limit: z.number().int().min(1).max(50).optional(),
        },
      },
      async (args: { limit?: number }) =>
        wrap(await tools.getRecentActivity(user, args)),
    );

    server.registerTool(
      'add_task_comment',
      {
        title: 'Add a comment to a task',
        description:
          'Post a comment to a task on the user\'s behalf. Use sparingly — ' +
          'only when the user has explicitly asked the assistant to log ' +
          'something, not for ambient narration.',
        inputSchema: {
          taskId: z.string().min(1),
          content: z.string().min(1).max(5000),
        },
      },
      async (args: { taskId: string; content: string }) =>
        wrap(await tools.addTaskComment(user, args)),
    );

    // ─── Write tools ────────────────────────────────────────────────

    server.registerTool(
      'create_project',
      {
        title: 'Create a project',
        description:
          'Create a new project. Auto-assigns the next P-XXXXX number. ' +
          'Defaults: status NEW, priority MEDIUM, assignee = caller. ' +
          'CLIENT-role users cannot call this.',
        inputSchema: {
          title: z.string().min(1).max(200),
          description: z.string().optional(),
          clientName: z.string().min(1).max(200),
          organizationId: z.string().optional(),
          priority: z.string().optional(),
          dueDate: z.string().optional(),
          assignedToId: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.createProject(user, args)),
    );

    server.registerTool(
      'update_project_status',
      {
        title: 'Update project status',
        description:
          'Change a project\'s status. Identify by id or projectNumber. ' +
          'Status: NEW / IN_PROGRESS / UNDER_REVIEW / COMPLETED / ARCHIVED / ' +
          'ON_HOLD. Setting COMPLETED also stamps completedAt.',
        inputSchema: {
          id: z.string().optional(),
          projectNumber: z.string().optional(),
          status: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.updateProjectStatus(user, args)),
    );

    server.registerTool(
      'create_task',
      {
        title: 'Create a task on a project',
        description:
          'Create a task on a project the caller can see. Identify the project ' +
          'by projectId or projectNumber. Defaults: type OTHER, priority MEDIUM, ' +
          'assignee = caller. CLIENT-role users cannot call this.',
        inputSchema: {
          projectId: z.string().optional(),
          projectNumber: z.string().optional(),
          title: z.string().min(1).max(200),
          description: z.string().optional(),
          type: z.string().optional(),
          priority: z.string().optional(),
          dueDate: z.string().optional(),
          assignedToId: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.createTask(user, args)),
    );

    server.registerTool(
      'update_task_status',
      {
        title: 'Update a task status',
        description:
          'Change a task\'s status. Status: PENDING / IN_PROGRESS / ' +
          'WAITING_FOR_CLIENT / COMPLETED / CANCELLED. Setting COMPLETED ' +
          'also stamps completedAt.',
        inputSchema: {
          taskId: z.string().min(1),
          status: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.updateTaskStatus(user, args)),
    );

    server.registerTool(
      'list_project_documents',
      {
        title: 'List documents attached to a project',
        description:
          'Return the file metadata (name, size, mime, uploader, uploaded date) ' +
          'for every document attached to a project the caller can see. Identify ' +
          'by projectId or projectNumber.',
        inputSchema: {
          projectId: z.string().optional(),
          projectNumber: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.listProjectDocuments(user, args)),
    );

    return server;
  }
}

function wrap(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}
