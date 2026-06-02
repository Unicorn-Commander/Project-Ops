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
import { MinioService } from '../documents/minio.service';
import { ProjectOpsTools } from './mcp.tools';
import { MCP_TOOL_SCOPE_MAP } from '../auth/pat/pat.constants';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
  ) {}

  /**
   * Build a fresh MCP server bound to one authenticated user.
   * Returns the server instance; caller connects a transport to it.
   *
   * Imports the SDK lazily to keep the cold-start path simple — the SDK ships
   * dual CJS/ESM and `require()` resolution into the cjs/ folder is fine, but
   * we still pay the resolve cost only when MCP is actually called.
   *
   * `grantedScopes`:
   *   - `null`/`undefined` -> caller is JWT-auth'd (browser session,
   *     Keycloak realm token, or Brigade federation JWT). The user's
   *     role-based RBAC inside ProjectOpsTools is the only gate; every
   *     registered tool is exposed.
   *   - `string[]` -> caller is PAT-auth'd. We wrap every tool handler
   *     so the call fails closed if the tool's required scope (per
   *     MCP_TOOL_SCOPE_MAP) is not in the granted list. Both the
   *     manifest-declared tools and the additional tools registered on
   *     the server are covered; an unknown tool name fails closed.
   */
  async createServerForUser(user: User, grantedScopes?: string[] | null) {
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
          'and recent activity for the calling user, post task comments, and ' +
          'create projects/tasks/organizations. All operations enforce the ' +
          'same RBAC as the Project Ops UI.',
      },
    );

    // Wrap registerTool so every tool call is automatically scope-gated
    // when the caller is PAT-auth'd. JWT-auth'd callers pass straight
    // through (grantedScopes == null), preserving existing behavior.
    const grantedSet = grantedScopes ? new Set(grantedScopes) : null;
    const rawRegister = server.registerTool.bind(server);
    server.registerTool = (
      name: string,
      schema: unknown,
      handler: (args: any) => Promise<any> | any,
    ) => {
      const gated = async (args: any) => {
        if (grantedSet) {
          const required = MCP_TOOL_SCOPE_MAP[name];
          if (!required) {
            this.logger.warn(
              `MCP tool "${name}" has no scope mapping; refusing PAT-auth invocation`,
            );
            return scopeDenied(name, undefined, [...grantedSet]);
          }
          if (!grantedSet.has(required)) {
            return scopeDenied(name, required, [...grantedSet]);
          }
        }
        return handler(args);
      };
      return rawRegister(name, schema, gated);
    };

    const tools = new ProjectOpsTools(this.prisma, this.minio, this.logger);

    server.registerTool(
      'list_my_projects',
      {
        title: 'List my projects',
        description:
          'Return the projects the calling user can see, newest first. ' +
          "Optional 'status' filters by ProjectStatus (NEW, IN_PROGRESS, " +
          'UNDER_REVIEW, COMPLETED, ARCHIVED, ON_HOLD).',
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
      async (args: { limit?: number }) => wrap(await tools.getRecentActivity(user, args)),
    );

    server.registerTool(
      'add_task_comment',
      {
        title: 'Add a comment to a task',
        description:
          "Post a comment to a task on the user's behalf. Use sparingly — " +
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
      'list_organizations',
      {
        title: 'List organizations',
        description:
          'Return organizations visible to the caller. Optional filters: ' +
          'type (AGENCY/BUSINESS/INDIVIDUAL/PARTNER), isActive (default ' +
          'returns both). CLIENT-role users only see their own org.',
        inputSchema: {
          type: z.string().optional(),
          isActive: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: any) => wrap(await tools.listOrganizations(user, args)),
    );

    server.registerTool(
      'get_organization',
      {
        title: 'Get an organization by id',
        description:
          'Return full detail for one organization, including parent, ' +
          'children, and counts of projects + contacts.',
        inputSchema: {
          id: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.getOrganization(user, args)),
    );

    server.registerTool(
      'update_organization',
      {
        title: 'Update an organization',
        description:
          'Patch an organization. Required: id. Only the fields you pass are ' +
          'updated. Set isActive=false to soft-delete (hides from default ' +
          'listings). parentOrgId reassigns hierarchy (pass null to detach). ' +
          'ADMIN/MANAGER only.',
        inputSchema: {
          id: z.string().min(1),
          name: z.string().min(1).max(200).optional(),
          type: z.string().optional(),
          taxId: z.string().nullable().optional(),
          industry: z.string().nullable().optional(),
          website: z.string().nullable().optional(),
          address: z.string().nullable().optional(),
          city: z.string().nullable().optional(),
          state: z.string().nullable().optional(),
          zipCode: z.string().nullable().optional(),
          country: z.string().nullable().optional(),
          parentOrgId: z.string().nullable().optional(),
          portalAccessEnabled: z.boolean().optional(),
          isActive: z.boolean().optional(),
          notes: z.string().nullable().optional(),
        },
      },
      async (args: any) => wrap(await tools.updateOrganization(user, args)),
    );

    server.registerTool(
      'create_organization',
      {
        title: 'Create an organization',
        description:
          'Create a new organization. Required: name + type ' +
          '(AGENCY / BUSINESS / INDIVIDUAL / PARTNER). Optional: taxId, ' +
          'industry, website, address fields, parentOrgId (for hierarchy), ' +
          'portalAccessEnabled, notes. Country defaults to USA, ' +
          'portalAccessEnabled defaults to false. Only ADMIN and MANAGER ' +
          'roles can call this.',
        inputSchema: {
          name: z.string().min(1).max(200),
          type: z.string().min(1),
          taxId: z.string().optional(),
          industry: z.string().optional(),
          website: z.string().optional(),
          address: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          zipCode: z.string().optional(),
          country: z.string().optional(),
          parentOrgId: z.string().optional(),
          portalAccessEnabled: z.boolean().optional(),
          notes: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.createOrganization(user, args)),
    );

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
          "Change a project's status. Identify by id or projectNumber. " +
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
      'update_project',
      {
        title: 'Update a project',
        description:
          'Patch a project. Identify by id or projectNumber. Only the fields ' +
          'you pass are updated. organizationId reassigns the project to a ' +
          'different organization (pass null to detach). CLIENT-role users ' +
          'cannot call this.',
        inputSchema: {
          id: z.string().optional(),
          projectNumber: z.string().optional(),
          title: z.string().min(1).max(200).optional(),
          description: z.string().optional(),
          clientName: z.string().min(1).max(200).optional(),
          organizationId: z.string().nullable().optional(),
          priority: z.string().optional(),
          dueDate: z.string().nullable().optional(),
          assignedToId: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.updateProject(user, args)),
    );

    server.registerTool(
      'update_task',
      {
        title: 'Update a task',
        description:
          'Patch a task. Required: taskId. Only fields passed are updated. ' +
          'projectId or projectNumber reparents the task to a different ' +
          'project the caller can see. CLIENT-role users cannot call this.',
        inputSchema: {
          taskId: z.string().min(1),
          title: z.string().min(1).max(200).optional(),
          description: z.string().optional(),
          type: z.string().optional(),
          priority: z.string().optional(),
          dueDate: z.string().nullable().optional(),
          assignedToId: z.string().optional(),
          projectId: z.string().optional(),
          projectNumber: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.updateTask(user, args)),
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
          "Change a task's status. Status: PENDING / IN_PROGRESS / " +
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

    server.registerTool(
      'get_document_content',
      {
        title: "Read a document's text content",
        description:
          'Fetch a document the user can see and return its text content. ' +
          'Identify by documentId, or by fileName + projectNumber. Text-friendly ' +
          'mime types (text/*, application/json, application/pdf, Office formats) ' +
          'come back as up to 50KB of extracted text. Other mime types return ' +
          '{ supported: false, downloadUrl } so the assistant can hand the user ' +
          'a link instead. PDFs are extracted via pdf-parse when installed; if ' +
          'unavailable the tool falls back to a download URL.',
        inputSchema: {
          documentId: z.string().optional(),
          fileName: z.string().optional(),
          projectNumber: z.string().optional(),
        },
      },
      async (args: { documentId?: string; fileName?: string; projectNumber?: string }) =>
        wrap(await tools.getDocumentContent(user, args)),
    );

    server.registerTool(
      'upload_document',
      {
        title: 'Upload a new document to a project',
        description:
          'Persist a new document on a project the caller can see. Provide ' +
          'projectId or projectNumber, the fileName, mimeType, and content ' +
          '(plain text for text/* and application/json, base64-encoded bytes ' +
          'otherwise). Cap: 25MB after decoding. CLIENT-role users cannot call ' +
          'this. Bypasses the staged presigned-URL flow — use when the agent ' +
          'already has the bytes in memory.',
        inputSchema: {
          projectId: z.string().optional(),
          projectNumber: z.string().optional(),
          fileName: z.string().min(1).max(500),
          content: z.string().min(1),
          mimeType: z.string().min(1),
          description: z.string().optional(),
        },
      },
      async (args: {
        projectId?: string;
        projectNumber?: string;
        fileName: string;
        content: string;
        mimeType: string;
        description?: string;
      }) => wrap(await tools.uploadDocument(user, args)),
    );

    server.registerTool(
      'update_billing_fields',
      {
        title: 'Update billing/invoicing fields on a project',
        description:
          "Patch a project's billing data — invoiceNumber, billingAmount, " +
          'amountPaid, paymentStatus (UNPAID / PARTIALLY_PAID / PAID / OVERDUE / ' +
          'CANCELLED), billingDate, paymentDueDate, paymentReceivedDate, ' +
          'billingNotes. Only the fields you pass are updated; omitted fields ' +
          'are left alone. CLIENT-role users cannot call this.',
        inputSchema: {
          id: z.string().optional(),
          projectNumber: z.string().optional(),
          invoiceNumber: z.string().optional(),
          billingAmount: z.number().optional(),
          amountPaid: z.number().optional(),
          paymentStatus: z.string().optional(),
          billingDate: z.string().optional(),
          paymentDueDate: z.string().optional(),
          paymentReceivedDate: z.string().optional(),
          billingNotes: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.updateBillingFields(user, args)),
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

/**
 * Standardized "this PAT can't call this tool" response. Returned
 * with `isError: true` so MCP clients surface it as a tool error
 * rather than a normal result, and includes the granted+required
 * scopes so the human operator can fix their token mint.
 */
function scopeDenied(toolName: string, required: string | undefined, granted: string[]) {
  const detail = {
    error: 'scope_denied',
    tool: toolName,
    required_scope: required ?? '(no mapping — refusing fail-open)',
    granted_scopes: granted,
    hint: 'Mint a new Personal Access Token at /dashboard/settings with the required scope.',
  };
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(detail, null, 2),
      },
    ],
  };
}
