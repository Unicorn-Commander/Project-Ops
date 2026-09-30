import { publicMcpUserPayload } from '../common/serialization/public-user';
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

import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgentVia, TaskPriority, TaskStatus, TaskType, User } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from '../documents/minio.service';
import { ProjectOpsTools, TimeTrackingDeps, Wave2Deps } from './mcp.tools';
import { MCP_TOOL_SCOPE_MAP } from '../auth/pat/pat.constants';
import { TriageService } from '../triage/triage.service';
import { timeTrackingEnabled } from '../common/workspace/feature-flags';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { TimerService } from '../time-tracking/timer.service';
import { TimeEntryService } from '../time-tracking/time-entry.service';
import { TimesheetService } from '../time-tracking/timesheet.service';
import { ReportsService } from '../time-tracking/reports.service';
import { BillableRollupService } from '../time-tracking/billing/billable-rollup.service';
// Wave 2 services — the MCP tools delegate to these so agents share the REST
// controllers' RBAC + workspace-RLS + validation (one code path).
import { ReportingService } from '../reporting/reporting.service';
import { CapacityService } from '../capacity/capacity.service';
import { AutomationsService } from '../automations/automations.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { ApprovalsService } from '../client-portal/approvals/approvals.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
// Agent activity capture (v1.11) — OPTIONAL: when AgentsModule is imported into
// McpModule the recorder is injected and every successful tool call is logged
// as an AgentEvent; if not wired, capture is silently skipped (app still boots).
import { AgentEventsService } from '../agents/agent-events.service';
import { deriveToolTarget, McpActorIdentity, resolveMcpActor } from '../agents/agent-capture.util';
import { recordMcpToolCall } from './mcp.metrics';

const TASK_TYPE_VALUES = Object.values(TaskType) as [TaskType, ...TaskType[]];
const TASK_PRIORITY_VALUES = Object.values(TaskPriority) as [TaskPriority, ...TaskPriority[]];
const TASK_STATUS_VALUES = Object.values(TaskStatus) as [TaskStatus, ...TaskStatus[]];

// Keep the historical case-forgiving MCP input while validating against the
// generated Prisma enum values before a tool reaches Prisma.
const taskEnum = <T extends string>(values: [T, ...T[]]) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toUpperCase() : value),
    z.enum(values),
  );

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly triage: TriageService,
    private readonly workspace: WorkspaceContextService,
    private readonly timer: TimerService,
    private readonly timeEntry: TimeEntryService,
    private readonly timesheet: TimesheetService,
    private readonly reports: ReportsService,
    private readonly rollup: BillableRollupService,
    // Global EventEmitter2 (EventEmitterModule.forRoot in app.module) — handed
    // to ProjectOpsTools so MCP-posted task comments emit the same
    // `task.comment.created` event the REST TasksService does, fanning out
    // @mention notifications identically.
    private readonly events: EventEmitter2,
    // Wave 2 services (reporting / capacity / automations / custom-fields /
    // approvals) — injected via their exporting modules (McpModule imports
    // them) and handed to ProjectOpsTools as Wave2Deps.
    private readonly reporting: ReportingService,
    private readonly capacity: CapacityService,
    private readonly automations: AutomationsService,
    private readonly customFields: CustomFieldsService,
    private readonly approvals: ApprovalsService,
    // Workspace member-management spine (invite/role/remove/list). Imported via
    // WorkspacesModule; handed to ProjectOpsTools for the member tools.
    private readonly workspaceAdmin: WorkspacesService,
    // OPTIONAL: present only when AgentsModule is imported into McpModule.
    @Optional() private readonly agentEvents?: AgentEventsService,
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
   *
   * `patWorkspaceId`:
   *   - When the caller is PAT-auth'd and the token is workspace-bound,
   *     this is the PAT's workspace. The guard already rejected any
   *     explicit X-Workspace-Id that disagreed with it; here we add a
   *     belt-and-suspenders chokepoint: every tool call asserts the
   *     acting user's resolved workspace still equals the PAT workspace
   *     and fails closed otherwise, so a workspace drift can never let a
   *     PAT act outside its bound workspace.
   */
  async createServerForUser(
    user: User,
    grantedScopes?: string[] | null,
    bearerToken?: string | null,
    patWorkspaceId?: string | null,
    // The authenticating PAT (id + human name), when the caller is PAT-auth'd.
    // Used ONLY for agent-activity capture (actorKey/actorLabel); not security-
    // bearing (scope + workspace gating already happen above). Undefined for
    // JWT/federation callers — capture resolves their identity from `user`.
    patIdentity?: { id: string; name?: string | null } | null,
    // The workspace THIS REQUEST addressed (SUITE-IDENTITY §D4: path param →
    // X-Workspace-Id header → token claim), as resolved — and, with tenancy
    // on, membership-authorized — by WorkspaceMembershipGuard onto
    // `req.workspaceId`. Threaded into ProjectOpsTools so every tool resolves
    // its workspace from the REQUEST first (mirroring REST's
    // @CurrentWorkspace), instead of silently ignoring an explicit
    // X-Workspace-Id from a JWT-auth'd MCP client. Null/undefined preserves
    // the prior behavior (claim → default membership).
    requestWorkspaceId?: string | null,
  ) {
    // Preserve the SDK's deliberate CommonJS interop at request setup.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
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
    // when the caller is PAT-auth'd, AND fails closed on a workspace drift
    // for a workspace-bound PAT. JWT-auth'd callers (grantedScopes == null,
    // patWorkspaceId == null) pass straight through, preserving behavior.
    const grantedSet = grantedScopes ? new Set(grantedScopes) : null;
    const boundWorkspaceId = patWorkspaceId ?? null;
    const addressedWorkspaceId = requestWorkspaceId ?? null;

    // Resolve this caller's agent identity ONCE (PAT / federation / user) for
    // activity capture. Cheap + pure. Capture itself is best-effort and never
    // blocks or fails a tool call.
    const recorder = this.agentEvents;
    // grantedScopes != null ⇒ the caller is PAT-auth'd (the controller only sets
    // it for PATs). That's the stable signal we have without the controller
    // threading the PAT id/name; `patIdentity` (if provided) enriches the label.
    const actor: McpActorIdentity | null = recorder
      ? resolveMcpActor(user, patIdentity, grantedScopes != null)
      : null;
    const captureWorkspaceId = () =>
      boundWorkspaceId ?? addressedWorkspaceId ?? this.workspace.resolve(user);

    const rawRegister = server.registerTool.bind(server);
    server.registerTool = (
      name: string,
      schema: unknown,
      handler: (args: any) => Promise<any> | any,
    ) => {
      const gated = async (args: any) => {
        // Workspace chokepoint: if this PAT is bound to a workspace, the
        // acting user's resolved workspace MUST still equal it. The guard
        // resolves them in lock-step, so a mismatch here means something
        // mutated the claim mid-flight — fail closed rather than let a tool
        // run against the wrong tenant.
        if (boundWorkspaceId) {
          const effective = this.workspace.resolve(user);
          if (effective !== boundWorkspaceId) {
            this.logger.warn(
              `MCP tool "${name}" workspace mismatch: PAT bound to ${boundWorkspaceId} but acting workspace resolved to ${effective}; refusing`,
            );
            recordMcpToolCall(name, 'denied', 0);
            return workspaceDenied(name, boundWorkspaceId, effective);
          }
        }
        const operationScope = MCP_TOOL_SCOPE_MAP[name];
        if (!operationScope) {
          recordMcpToolCall(name, 'denied', 0);
          return scopeDenied(name, undefined, [...(grantedSet ?? [])]);
        }
        if (grantedSet) {
          const required = MCP_TOOL_SCOPE_MAP[name];
          if (!required) {
            this.logger.warn(
              `MCP tool "${name}" has no scope mapping; refusing PAT-auth invocation`,
            );
            recordMcpToolCall(name, 'denied', 0);
            return scopeDenied(name, undefined, [...grantedSet]);
          }
          if (!grantedSet.has(required)) {
            recordMcpToolCall(name, 'denied', 0);
            return scopeDenied(name, required, [...grantedSet]);
          }
        }
        {
          try {
            await this.workspace.resolveAuthorized(user, boundWorkspaceId ?? addressedWorkspaceId);
            if (operationScope.startsWith('write:')) {
              await this.workspace.assertCanWrite(user, boundWorkspaceId ?? addressedWorkspaceId);
            }
          } catch {
            recordMcpToolCall(name, 'denied', 0);
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: operationScope.startsWith('write:')
                      ? 'workspace_write_denied'
                      : 'workspace_access_denied',
                    tool: name,
                    hint: operationScope.startsWith('write:')
                      ? 'An active MEMBER or higher workspace role is required.'
                      : 'Active workspace membership is required.',
                  }),
                },
              ],
            };
          }
        }
        const startedAt = Date.now();
        try {
          const result = publicMcpUserPayload(await handler(args));
          const durationMs = Date.now() - startedAt;
          // isError envelopes (scope/workspace denied above, or tool-returned
          // error payloads) count as error for ops metrics when the body set
          // the flag; successful content is ok.
          const isError = !!(result && (result as any).isError);
          recordMcpToolCall(name, isError ? 'error' : 'ok', durationMs);
          this.logger.log(
            `MCP tool=${name} status=${isError ? 'error' : 'ok'} durationMs=${durationMs}`,
          );
          // Best-effort agent-activity capture AFTER a successful call. Skipped on
          // an error envelope; never awaited into the response path; never throws
          // (the recorder swallows its own errors, and we guard the derive too).
          if (recorder && actor && !isError) {
            try {
              const raw = unwrapToolResult(result);
              const target = deriveToolTarget(name, args, raw);
              void recorder.record({
                workspaceId: captureWorkspaceId(),
                user,
                actorKind: actor.actorKind,
                actorKey: actor.actorKey,
                actorLabel: actor.actorLabel,
                via: AgentVia.MCP,
                action: name,
                resource: target.resource,
                resourceId: target.resourceId,
                projectId: target.projectId,
                taskId: target.taskId,
                // MCP tool calls are zero-LLM-cost actions: no tokens / cost.
                durationMs,
              });
            } catch (err) {
              this.logger.debug(`agent capture skipped for "${name}": ${(err as Error).message}`);
            }
          }
          return result;
        } catch (err) {
          const durationMs = Date.now() - startedAt;
          recordMcpToolCall(name, 'error', durationMs);
          const safeMessage = sanitizePrismaError(err);
          this.logger.warn(
            `MCP tool=${name} status=error durationMs=${durationMs} err=${safeMessage ?? (err as Error).message}`,
          );
          if (safeMessage) {
            return {
              isError: true,
              content: [{ type: 'text' as const, text: JSON.stringify({ error: safeMessage }) }],
            };
          }
          throw err;
        }
      };
      return rawRegister(name, schema, gated);
    };

    const ttDeps: TimeTrackingDeps = {
      timer: this.timer,
      timeEntry: this.timeEntry,
      timesheet: this.timesheet,
      reports: this.reports,
      rollup: this.rollup,
      workspace: this.workspace,
    };
    const wave2Deps: Wave2Deps = {
      reporting: this.reporting,
      capacity: this.capacity,
      automations: this.automations,
      customFields: this.customFields,
      approvals: this.approvals,
    };
    const tools = new ProjectOpsTools(
      this.prisma,
      this.minio,
      this.logger,
      this.triage,
      ttDeps,
      bearerToken ?? null,
      this.workspace,
      this.events,
      wave2Deps,
      this.workspaceAdmin,
      addressedWorkspaceId,
    );

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
          'including recent tasks and comments. A project created from an ' +
          'accepted quote also carries `quote` / `metadata.quote` ' +
          '(Customer-Ops ids: customer_ops_quote_id, number, version, ' +
          'share_url, schedule_ids); CLIENT callers see number, version and ' +
          'share_url only.',
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
          "Optional 'status' filters by TaskStatus " +
          `(TaskStatus: ${TASK_STATUS_VALUES.join(' / ')}).`,
        inputSchema: {
          status: taskEnum(TASK_STATUS_VALUES).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      async (args: { status?: string; limit?: number }) =>
        wrap(await tools.listMyTasks(user, args)),
    );

    server.registerTool(
      'get_task',
      {
        title: 'Get a task by id',
        description:
          'Return full detail for a single task the caller can see (via its ' +
          'parent project): description, status, priority, type, due/completed ' +
          'dates, estimatedHours, metadata, assignee, creator, parent task, ' +
          'comment/subtask counts, and dependency edges (dependsOn + blocks). ' +
          'isBlocked is NOT computed here (deferred until dep-enforcement ' +
          'merges); infer open blockers from dependencies.dependsOn predecessor ' +
          'status. Requires taskId.',
        inputSchema: {
          taskId: z.string().min(1),
        },
      },
      async (args: { taskId: string }) => wrap(await tools.getTask(user, args)),
    );

    server.registerTool(
      'list_project_tasks',
      {
        title: 'List tasks for a project',
        description:
          'Return tasks on one project the caller can see. Identify the project ' +
          'by projectId or projectNumber (either field may hold a UUID or a ' +
          'human project number). Window (explicit): offset/limit pagination — ' +
          'limit defaults to 25 (max 100), offset defaults to 0; ordered by ' +
          'priority desc, dueDate asc, createdAt desc. Optional filters: status ' +
          `(TaskStatus: ${TASK_STATUS_VALUES.join(' / ')}) and priority ` +
          `(${TASK_PRIORITY_VALUES.join(' / ')}). Response: ` +
          '{ project, tasks, count, total, offset, limit } where count is the ' +
          'page size and total is the full match count for paging.',
        inputSchema: {
          projectId: z.string().optional(),
          projectNumber: z.string().optional(),
          status: taskEnum(TASK_STATUS_VALUES).optional(),
          priority: taskEnum(TASK_PRIORITY_VALUES).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async (args: {
        projectId?: string;
        projectNumber?: string;
        status?: string;
        priority?: string;
        limit?: number;
        offset?: number;
      }) => wrap(await tools.listProjectTasks(user, args)),
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
          "Post a comment (maximum 5,000 characters) to a task on the user's behalf. Use sparingly — " +
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

    server.registerTool(
      'list_task_comments',
      {
        title: 'List comments on a task',
        description:
          'Return the comment thread for a task the caller can see, oldest first. ' +
          'Optional limit (default 50, max 100) and offset for pagination. ' +
          'Requires read:tasks when called with a PAT.',
        inputSchema: {
          taskId: z.string().min(1),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async (args: { taskId: string; limit?: number; offset?: number }) =>
        wrap(await tools.listTaskComments(user, args)),
    );

    server.registerTool(
      'update_task_comment',
      {
        title: 'Update a task comment',
        description:
          'Edit a task comment by id. Only the author or an ADMIN may update. ' +
          'Same ownership rule as the REST TasksService / project-comment UI. ' +
          'Does not re-fan-out @mentions (matches REST update).',
        inputSchema: {
          commentId: z.string().min(1),
          content: z.string().min(1).max(5000),
        },
      },
      async (args: { commentId: string; content: string }) =>
        wrap(await tools.updateTaskComment(user, args)),
    );

    server.registerTool(
      'delete_task_comment',
      {
        title: 'Delete a task comment',
        description:
          'Delete a task comment by id. Only the author, ADMIN, or MANAGER may ' +
          'delete — same ownership rule as the REST TasksService / project-comment UI.',
        inputSchema: {
          commentId: z.string().min(1),
        },
      },
      async (args: { commentId: string }) => wrap(await tools.deleteTaskComment(user, args)),
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
          'CLIENT-role users cannot call this. Optional customFields (object ' +
          'keyed by the workspace PROJECT custom-field key — validated + stored ' +
          'under metadata.customFields) and recurrenceRule (RRULE subset).',
        inputSchema: {
          title: z.string().min(1).max(200),
          description: z.string().optional(),
          clientName: z.string().min(1).max(200),
          organizationId: z.string().optional(),
          priority: z.string().optional(),
          dueDate: z.string().optional(),
          assignedToId: z.string().optional(),
          customFields: z.record(z.string(), z.any()).optional(),
          recurrenceRule: z.string().optional(),
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
          'cannot call this. Optional customFields (object keyed by the workspace ' +
          'PROJECT custom-field key — validated + merged into metadata.customFields, ' +
          'preserving other metadata) and recurrenceRule (RRULE subset; null clears it).',
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
          customFields: z.record(z.string(), z.any()).optional(),
          recurrenceRule: z.string().nullable().optional(),
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
          'project the caller can see. CLIENT-role users cannot call this. ' +
          `Allowed type values: ${TASK_TYPE_VALUES.join(' / ')}. ` +
          `Allowed priority values: ${TASK_PRIORITY_VALUES.join(' / ')}. ` +
          'Optional customFields (object keyed by the workspace TASK custom-field ' +
          'key — validated + merged into metadata.customFields, preserving other ' +
          'metadata), recurrenceRule (RRULE subset; null clears it), and ' +
          'estimatedHours (null clears it), and fixedAmount (a flat fee, ' +
          'quantity 1; null clears it until the fee has been invoiced).',
        inputSchema: {
          taskId: z.string().min(1),
          title: z.string().min(1).max(200).optional(),
          description: z.string().optional(),
          type: taskEnum(TASK_TYPE_VALUES).optional(),
          priority: taskEnum(TASK_PRIORITY_VALUES).optional(),
          dueDate: z.string().nullable().optional(),
          assignedToId: z.string().optional(),
          projectId: z.string().optional(),
          projectNumber: z.string().optional(),
          customFields: z.record(z.string(), z.any()).optional(),
          recurrenceRule: z.string().nullable().optional(),
          estimatedHours: z.number().min(0).nullable().optional(),
          fixedAmount: z.number().min(0).nullable().optional(),
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
          `by projectId or projectNumber. Allowed type values: ${TASK_TYPE_VALUES.join(' / ')}. ` +
          `Allowed priority values: ${TASK_PRIORITY_VALUES.join(' / ')}. Defaults: type OTHER, priority MEDIUM, ` +
          'assignee = caller. CLIENT-role users cannot call this. Optional ' +
          'parentTaskId creates a subtask under an existing task in the same ' +
          'project (parent must be visible in the workspace; cross-project ' +
          'parents are rejected). Optional customFields (object keyed by the ' +
          'workspace TASK custom-field key — validated + stored under ' +
          'metadata.customFields), recurrenceRule (an RRULE subset, e.g. ' +
          '"FREQ=WEEKLY;INTERVAL=1", makes this a recurrence template), and ' +
          'estimatedHours (effort estimate used by capacity planning), and ' +
          'fixedAmount (a flat fee for this task, quantity 1).',
        inputSchema: {
          projectId: z.string().optional(),
          projectNumber: z.string().optional(),
          title: z.string().min(1).max(200),
          description: z.string().optional(),
          type: taskEnum(TASK_TYPE_VALUES).optional(),
          priority: taskEnum(TASK_PRIORITY_VALUES).optional(),
          dueDate: z.string().optional(),
          assignedToId: z.string().optional(),
          parentTaskId: z.string().min(1).optional(),
          customFields: z.record(z.string(), z.any()).optional(),
          recurrenceRule: z.string().optional(),
          estimatedHours: z.number().min(0).optional(),
          fixedAmount: z.number().min(0).optional(),
        },
      },
      async (args: any) => wrap(await tools.createTask(user, args)),
    );

    server.registerTool(
      'list_task_subtasks',
      {
        title: 'List direct subtasks of a task',
        description:
          'Return the direct children of a parent task the caller can see (via ' +
          'its project). Ordered by priority desc, dueDate asc, createdAt desc ' +
          '(matches REST getSubtasks). Response: { parent, subtasks, count } ' +
          'with assignee/creator and nested comment/subtask counts on each child.',
        inputSchema: {
          taskId: z.string().min(1),
        },
      },
      async (args: { taskId: string }) => wrap(await tools.listTaskSubtasks(user, args)),
    );

    server.registerTool(
      'submit_candidate_action_items',
      {
        title: 'Submit candidate action items to triage',
        description:
          'Submit candidate action items (from Meeting-Ops or any source) to the ' +
          'PO triage agent. Propose-only: each item is routed to a best-fit project ' +
          'and written as a TriageProposal for human review — no tasks/projects are ' +
          'created until a human approves. Idempotent on (sourceType, ' +
          'sourceActionItemId). CLIENT-role users cannot call this.',
        inputSchema: {
          items: z.array(
            z.object({
              text: z.string(),
              owner: z.string().optional(),
              sourceActionItemId: z.string().optional(),
            }),
          ),
          sourceType: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.submitCandidateActionItems(user, args)),
    );

    server.registerTool(
      'update_task_status',
      {
        title: 'Update a task status',
        description:
          `Change a task's status. Allowed values: ${TASK_STATUS_VALUES.join(' / ')}. Setting COMPLETED ` +
          'also stamps completedAt.',
        inputSchema: {
          taskId: z.string().min(1),
          status: taskEnum(TASK_STATUS_VALUES),
        },
      },
      async (args: any) => wrap(await tools.updateTaskStatus(user, args)),
    );

    // Hard-delete a task (ADMIN only) — mirrors REST DELETE /tasks/:id.
    // Intentional asymmetry vs archive_project: projects cannot be hard-deleted
    // via MCP (archive only); tasks can, matching the REST admin surface.
    server.registerTool(
      'delete_task',
      {
        title: 'Delete a task (ADMIN only)',
        description:
          'Permanently delete a task by taskId. ADMIN only — same RBAC as REST ' +
          'DELETE /tasks/:id. Not available to MANAGER/STAFF/CLIENT. This is a ' +
          'hard delete (unlike archive_project, which is the safe reversible ' +
          'alternative for projects; project hard-delete is intentionally not ' +
          'exposed to agents).',
        inputSchema: {
          taskId: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.deleteTask(user, args)),
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
      'update_document',
      {
        title: 'Update document metadata',
        description:
          'Patch metadata on a document the caller can see. Required: documentId. ' +
          'Optional fields (only passed fields are updated): description (null or ' +
          'empty clears it), tags (string array, replaces the whole set), fileName ' +
          '(display name rename — does not move storage). Does not allow rewriting ' +
          'storage fields (s3Key / fileSize / mimeType / projectId / status). ' +
          'CLIENT-role users cannot call this. Mirrors REST PATCH /documents/:id ' +
          'for the safe metadata surface.',
        inputSchema: {
          documentId: z.string().min(1),
          description: z.string().nullable().optional(),
          tags: z.array(z.string()).optional(),
          fileName: z.string().min(1).max(500).optional(),
        },
      },
      async (args: {
        documentId: string;
        description?: string | null;
        tags?: string[];
        fileName?: string;
      }) => wrap(await tools.updateDocument(user, args)),
    );

    server.registerTool(
      'delete_document',
      {
        title: 'Delete a document',
        description:
          'Permanently delete a document the caller can see (DB row + MinIO object ' +
          'when uploaded). Required: documentId. CLIENT-role users cannot call this. ' +
          'Mirrors REST DELETE /documents/:id. Irreversible — prefer careful use.',
        inputSchema: {
          documentId: z.string().min(1),
        },
      },
      async (args: { documentId: string }) => wrap(await tools.deleteDocument(user, args)),
    );

    server.registerTool(
      'update_billing_fields',
      {
        title: 'Update billing/invoicing fields on a project',
        description:
          "Patch a project's billing data — invoiceNumber, billingAmount, " +
          'amountPaid, paymentStatus (UNPAID / PARTIALLY_PAID / PAID / OVERDUE / ' +
          'CANCELLED), billingDate, paymentDueDate, paymentReceivedDate, ' +
          'billingNotes, flatFeeAmount (the project flat fee; not billingAmount), ' +
          'customerOpsCustomerId and contactOpsContactId. Only the fields you ' +
          'pass are updated. CLIENT-role users cannot call this.',
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
          flatFeeAmount: z.number().min(0).nullable().optional(),
          customerOpsCustomerId: z.string().nullable().optional(),
          contactOpsContactId: z.string().nullable().optional(),
        },
      },
      async (args: any) => wrap(await tools.updateBillingFields(user, args)),
    );

    // ── Wave 2 tools (reporting / capacity / automations / custom-fields /
    //    approvals) — delegate to the same services the REST controllers use,
    //    so RBAC + workspace RLS + validation are shared. Not feature-flag
    //    gated; PAT scope gating is via MCP_TOOL_SCOPE_MAP. ──

    server.registerTool(
      'get_portfolio_report',
      {
        title: 'Portfolio health report',
        description:
          'Per-project health roll-up + workspace totals: budgeted vs logged ' +
          'hours, accrued billable vs budget amount, % complete, status, and an ' +
          'over-budget flag. Scoped to the projects the caller can see. Read-only.',
        inputSchema: {},
      },
      async (args: any) => wrap(await tools.getPortfolioReport(user, args)),
    );

    server.registerTool(
      'get_profitability_report',
      {
        title: 'Profitability report (MANAGER/ADMIN)',
        description:
          'Per-project + workspace profitability: billable amount, cost basis, ' +
          'margin, margin %, and realization (billed/billable) over an optional ' +
          'from/to ISO window. Exposes internal cost/margin, so MANAGER/ADMIN only. ' +
          'Read-only.',
        inputSchema: {
          from: z.string().optional(),
          to: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.getProfitabilityReport(user, args)),
    );

    server.registerTool(
      'get_throughput_report',
      {
        title: 'Throughput report',
        description:
          'Tasks + projects COMPLETED over a window, bucketed by ISO week, plus a ' +
          'status breakdown of tasks created in-window. Defaults to the trailing ' +
          '12 weeks when from/to are omitted. Read-only.',
        inputSchema: {
          from: z.string().optional(),
          to: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.getThroughputReport(user, args)),
    );

    server.registerTool(
      'get_team_capacity',
      {
        title: 'Team capacity report (MANAGER/ADMIN)',
        description:
          'Per-user committed hours (sum of estimatedHours on in-window, not-done ' +
          'assigned tasks) vs pro-rated weekly capacity across a date window ' +
          '(defaults to the current week), with over-allocation flags + workspace ' +
          'totals. A planning surface — MANAGER/ADMIN only. Read-only.',
        inputSchema: {
          from: z.string().optional(),
          to: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.getTeamCapacity(user, args)),
    );

    server.registerTool(
      'get_my_capacity',
      {
        title: 'My capacity',
        description:
          "The calling user's OWN committed load vs capacity over a date window " +
          '(defaults to the current week). Any active member may call it; a ' +
          'non-member is refused. Read-only.',
        inputSchema: {
          from: z.string().optional(),
          to: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.getMyCapacity(user, args)),
    );

    server.registerTool(
      'list_automations',
      {
        title: 'List automation rules (MANAGER/ADMIN)',
        description:
          'List the workspace automation rules, newest first. Optional filters: ' +
          'trigger (TASK_CREATED, TASK_STATUS_CHANGED, TASK_ASSIGNED, ' +
          'TASK_COMPLETED, PROJECT_CREATED, PROJECT_STATUS_CHANGED, ' +
          'COMMENT_CREATED) and enabled. MANAGER/ADMIN only.',
        inputSchema: {
          trigger: z.string().optional(),
          enabled: z.boolean().optional(),
        },
      },
      async (args: any) => wrap(await tools.listAutomations(user, args)),
    );

    server.registerTool(
      'create_automation',
      {
        title: 'Create an automation rule (MANAGER/ADMIN)',
        description:
          'Create a rule { name, trigger, conditions[], actions[] }. trigger is ' +
          'one of the AutomationTrigger values. conditions is an optional array of ' +
          '{ field, op (eq|neq|contains|gt|lt), value } — ALL must match (AND). ' +
          'actions is a required non-empty array of { type, params }; type is one ' +
          'of assign_task / set_status / add_comment / create_task / notify. ' +
          'enabled defaults to true. MANAGER/ADMIN only.',
        inputSchema: {
          name: z.string().min(1).max(200),
          trigger: z.string().min(1),
          conditions: z.array(z.any()).optional(),
          actions: z.array(z.any()).min(1),
          enabled: z.boolean().optional(),
        },
      },
      async (args: any) => wrap(await tools.createAutomation(user, args)),
    );

    server.registerTool(
      'set_automation_enabled',
      {
        title: 'Enable/disable an automation rule (MANAGER/ADMIN)',
        description:
          'Toggle a rule on or off by id without changing its trigger/conditions/' +
          'actions. MANAGER/ADMIN only.',
        inputSchema: {
          id: z.string().min(1),
          enabled: z.boolean(),
        },
      },
      async (args: any) => wrap(await tools.setAutomationEnabled(user, args)),
    );

    server.registerTool(
      'delete_automation',
      {
        title: 'Delete an automation rule (MANAGER/ADMIN)',
        description: 'Permanently delete an automation rule by id. MANAGER/ADMIN only.',
        inputSchema: {
          id: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.deleteAutomation(user, args)),
    );

    server.registerTool(
      'list_custom_fields',
      {
        title: 'List custom-field definitions',
        description:
          'List the workspace custom-field DEFINITIONS for an entity (key, label, ' +
          'type, options, required, position), ordered by position then label. ' +
          "Required: entity ('TASK' or 'PROJECT'). Use the returned keys when " +
          'setting customFields values via create_task / update_task / ' +
          'create_project / update_project.',
        inputSchema: {
          entity: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.listCustomFields(user, args)),
    );

    server.registerTool(
      'list_project_approvals',
      {
        title: 'List approvals on a project (staff)',
        description:
          "List ALL client approvals on a project — the requesting staff's view of " +
          'live client decisions (pending first). Requires projectId. Staff only ' +
          '(CLIENT-role users cannot call this).',
        inputSchema: {
          projectId: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.listProjectApprovals(user, args)),
    );

    server.registerTool(
      'request_approval',
      {
        title: 'Request a client approval (staff)',
        description:
          'Request a client approval on a document / deliverable / project ' +
          '(status PENDING). entityType is one of the ApprovalEntityType values; ' +
          'entityId is the id of the thing being submitted. Optional projectId ' +
          '(drives client scoping), approverContactId (a specific contact; else ' +
          "any portal client on the linked project's contact may act), and note. " +
          'Staff only (CLIENT-role users cannot call this).',
        inputSchema: {
          entityType: z.string().min(1),
          entityId: z.string().min(1),
          projectId: z.string().optional(),
          approverContactId: z.string().optional(),
          note: z.string().max(5000).optional(),
        },
      },
      async (args: any) => wrap(await tools.requestApproval(user, args)),
    );

    // ── Custom-field definition create ──
    server.registerTool(
      'create_custom_field',
      {
        title: 'Create a custom-field definition',
        description:
          'Define a new custom field for an entity. entity is TASK or PROJECT; type is one of ' +
          'TEXT/NUMBER/DATE/SELECT/MULTISELECT/BOOLEAN. label is required; key is auto-slugified ' +
          'from label when omitted; options (string[]) is required for SELECT/MULTISELECT. ' +
          'Optional required (default false) and position. After creating, set values via ' +
          'create_task / update_task / create_project / update_project. Non-CLIENT members only.',
        inputSchema: {
          entity: z.string().min(1),
          label: z.string().min(1),
          type: z.string().min(1),
          key: z.string().optional(),
          options: z.array(z.string()).optional(),
          required: z.boolean().optional(),
          position: z.number().int().min(0).optional(),
        },
      },
      async (args: any) => wrap(await tools.createCustomField(user, args)),
    );

    // ── Project archive (the agent-safe alternative to deletion) ──
    server.registerTool(
      'archive_project',
      {
        title: 'Archive (retire) a project',
        description:
          'Archive a project — sets status to ARCHIVED, the safe + reversible alternative to ' +
          'deletion. Project-Ops does NOT expose permanent project deletion to agents; archived ' +
          'projects are hidden from active views but preserved. Identify by id or projectNumber. ' +
          'Un-archive with update_project_status. CLIENT users cannot.',
        inputSchema: {
          id: z.string().optional(),
          projectNumber: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.archiveProject(user, args)),
    );

    // ── Workspace member management (delegates to WorkspacesService) ──
    server.registerTool(
      'list_members',
      {
        title: 'List workspace members',
        description:
          'List the members of your active workspace, including pending invites. Returns each ' +
          "member's userKey + workspace role (VIEWER/MEMBER/MANAGER/ADMIN/OWNER). Pass a returned " +
          'userKey to update_member_role / remove_member. Any active member.',
        inputSchema: {},
      },
      async (args: any) => wrap(await tools.listMembers(user, args)),
    );

    server.registerTool(
      'invite_member',
      {
        title: 'Invite a member to the workspace',
        description:
          'Add or invite someone to your active workspace by email. If they already have an ' +
          'account they are added immediately; otherwise an invite LINK is returned (no email is ' +
          'sent — share the link). role is VIEWER/MEMBER/MANAGER/ADMIN (default MEMBER; OWNER ' +
          'cannot be granted here). OWNER/ADMIN only.',
        inputSchema: {
          email: z.string().min(1),
          role: z.string().optional(),
        },
      },
      async (args: any) => wrap(await tools.inviteMember(user, args)),
    );

    server.registerTool(
      'update_member_role',
      {
        title: "Change a member's workspace role",
        description:
          "Change a member's workspace role. userKey identifies the member (get it from " +
          'list_members); role is VIEWER/MEMBER/MANAGER/ADMIN/OWNER. OWNER only; the last OWNER ' +
          'cannot be demoted.',
        inputSchema: {
          userKey: z.string().min(1),
          role: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.updateMemberRole(user, args)),
    );

    server.registerTool(
      'remove_member',
      {
        title: 'Remove a member from the workspace',
        description:
          'Remove a member from your active workspace. userKey identifies the member (from ' +
          'list_members). OWNER only; the last OWNER cannot be removed.',
        inputSchema: {
          userKey: z.string().min(1),
        },
      },
      async (args: any) => wrap(await tools.removeMember(user, args)),
    );

    // ── Time tracking tools (gated by TIME_TRACKING_ENABLED) ──
    if (timeTrackingEnabled()) {
      server.registerTool(
        'start_timer',
        {
          title: 'Start a work timer',
          description:
            'Start a running timer for the caller against a project or task. Any existing ' +
            'running timer is stopped first. Provide projectId or taskId. CLIENT users cannot.',
          inputSchema: {
            projectId: z.string().optional(),
            taskId: z.string().optional(),
            description: z.string().optional(),
          },
        },
        async (args: any) => wrap(await tools.startTimer(user, args)),
      );

      server.registerTool(
        'stop_timer',
        {
          title: 'Stop the running timer',
          description:
            "Stop the caller's running timer. Computes duration, applies rounding, resolves the " +
            'bill rate, and stores the billable amount.',
          inputSchema: {},
        },
        async (args: any) => wrap(await tools.stopTimer(user, args)),
      );

      server.registerTool(
        'log_time',
        {
          title: 'Log a manual time entry',
          description:
            'Create a manual time entry. Provide startedAt+endedAt, startedAt+durationMinutes, ' +
            'endedAt+durationMinutes, or just durationMinutes. Identify work by projectId or taskId. ' +
            'billable defaults to the task/project policy. CLIENT users cannot.',
          inputSchema: {
            projectId: z.string().optional(),
            taskId: z.string().optional(),
            description: z.string().optional(),
            startedAt: z.string().optional(),
            endedAt: z.string().optional(),
            durationMinutes: z.number().min(0).optional(),
            billable: z.boolean().optional(),
          },
        },
        async (args: any) => wrap(await tools.logTime(user, args)),
      );

      server.registerTool(
        'update_time_entry',
        {
          title: 'Update a time entry',
          description:
            'Patch a DRAFT, unlocked, unbilled time entry (id required). Locked or billed entries ' +
            'are immutable. Only supplied fields change.',
          inputSchema: {
            id: z.string().min(1),
            description: z.string().optional(),
            taskId: z.string().optional(),
            startedAt: z.string().optional(),
            endedAt: z.string().optional(),
            durationMinutes: z.number().min(0).optional(),
            billable: z.boolean().optional(),
          },
        },
        async (args: any) => wrap(await tools.updateTimeEntry(user, args)),
      );

      server.registerTool(
        'delete_time_entry',
        {
          title: 'Delete a time entry',
          description:
            'Delete a DRAFT, unlocked, unbilled time entry (id required). Locked, billed, or ' +
            'non-DRAFT (SUBMITTED/APPROVED/REJECTED) entries cannot be deleted. Owner or ' +
            'ADMIN/MANAGER; CLIENT users cannot. Mirrors REST DELETE /time-entries/:id.',
          inputSchema: {
            id: z.string().min(1),
          },
        },
        async (args: any) => wrap(await tools.deleteTimeEntry(user, args)),
      );

      server.registerTool(
        'list_time_entries',
        {
          title: 'List time entries',
          description:
            'List the caller-visible time entries, newest first, paginated. Filters: userId, ' +
            'projectId, taskId, from, to (ISO dates), billable, billed, approvalStatus ' +
            '(DRAFT/SUBMITTED/APPROVED/REJECTED). CLIENT callers never see cost rates.',
          inputSchema: {
            userId: z.string().optional(),
            projectId: z.string().optional(),
            taskId: z.string().optional(),
            from: z.string().optional(),
            to: z.string().optional(),
            billable: z.boolean().optional(),
            billed: z.boolean().optional(),
            approvalStatus: z.string().optional(),
            page: z.number().int().min(1).optional(),
            limit: z.number().int().min(1).max(200).optional(),
          },
        },
        async (args: any) => wrap(await tools.listTimeEntries(user, args)),
      );

      server.registerTool(
        'submit_timesheet',
        {
          title: 'Submit a weekly timesheet',
          description:
            "Submit the caller's DRAFT entries for the week containing periodStart (default: this " +
            'week) for approval. Groups them into a timesheet period set to SUBMITTED.',
          inputSchema: { periodStart: z.string().optional() },
        },
        async (args: any) => wrap(await tools.submitTimesheet(user, args)),
      );

      server.registerTool(
        'approve_time',
        {
          title: 'Approve submitted time',
          description:
            'Approve a whole submitted period (timesheetPeriodId) or specific entries ' +
            '(timeEntryIds). Approved entries lock against edits. MANAGER/ADMIN only.',
          inputSchema: {
            timesheetPeriodId: z.string().optional(),
            timeEntryIds: z.array(z.string()).optional(),
          },
        },
        async (args: any) => wrap(await tools.approveTime(user, args)),
      );

      server.registerTool(
        'get_utilization',
        {
          title: 'Utilization report',
          description:
            'Billable vs total hours per user over an optional period (from/to ISO dates). ' +
            'Optionally narrow to one userId.',
          inputSchema: {
            from: z.string().optional(),
            to: z.string().optional(),
            userId: z.string().optional(),
          },
        },
        async (args: any) => wrap(await tools.getUtilization(user, args)),
      );

      server.registerTool(
        'create_billable_draft',
        {
          title: 'Create a billable draft (→ Accounting-Ops invoice)',
          description:
            'Preview an invoice for a projectId or clientId: approved unbilled time plus ' +
            'uninvoiced flat fees (groupBy TASK/ROLE/DAY/NONE). When Accounting-Ops is connected ' +
            'this stores a draft and does not post the journal or stamp the fee. Pass issue=true ' +
            'to post it. MANAGER/ADMIN only.',
          inputSchema: {
            projectId: z.string().optional(),
            clientId: z.string().optional(),
            periodStart: z.string().optional(),
            periodEnd: z.string().optional(),
            groupBy: z.string().optional(),
            autoSend: z.boolean().optional(),
            issue: z.boolean().optional(),
          },
        },
        async (args: any) => wrap(await tools.createBillableDraft(user, args)),
      );

      server.registerTool(
        'issue_invoice',
        {
          title: 'Issue + send an invoice (→ Accounting-Ops)',
          description:
            'Roll up approved time and uninvoiced flat fees for a projectId or clientId and ' +
            'ISSUE the invoice in Accounting-Ops (post the journal, stage the email draft). ' +
            'Optional periodStart/periodEnd + groupBy (TASK/ROLE/DAY/NONE). When Accounting-Ops ' +
            "isn't connected this returns a preview and does not stamp the fee. MANAGER/ADMIN only.",
          inputSchema: {
            projectId: z.string().optional(),
            clientId: z.string().optional(),
            periodStart: z.string().optional(),
            periodEnd: z.string().optional(),
            groupBy: z.string().optional(),
          },
        },
        async (args: any) => wrap(await tools.issueInvoice(user, args)),
      );

      server.registerTool(
        'sync_invoice_status',
        {
          title: 'Sync invoice status from Accounting-Ops',
          description:
            'Pull current status (sent/partial/paid/overdue) for billed entries from Accounting-Ops ' +
            "and mirror it onto the linked projects. Uses the caller's token.",
          inputSchema: {},
        },
        async (args: any) => wrap(await tools.syncInvoiceStatus(user, args)),
      );
    }

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

/** Never expose Prisma's generated query/invocation text over MCP. */
function sanitizePrismaError(error: unknown): string | null {
  const name = error && typeof error === 'object' ? (error as { name?: unknown }).name : undefined;
  if (name === 'PrismaClientKnownRequestError' || name === 'PrismaClientValidationError') {
    return 'invalid input';
  }
  return null;
}

/**
 * Recover the raw tool object from a `wrap()`-ed MCP result envelope (the
 * handlers return `wrap(<obj>)`, which serializes the object into
 * `content[0].text`). Used ONLY by agent-activity capture to derive the touched
 * project/task. Returns null on any non-standard shape — capture then records
 * the event with no target rather than failing.
 */
function unwrapToolResult(result: any): any {
  try {
    const text = result?.content?.[0]?.text;
    return typeof text === 'string' ? JSON.parse(text) : null;
  } catch {
    return null;
  }
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

/**
 * "This PAT is scoped to a different workspace" response — the MCP-layer
 * mirror of the JwtAuthGuard 403. Returned with `isError: true` so clients
 * surface it as a tool error. A PAT for W1 can never act on W2.
 */
function workspaceDenied(toolName: string, bound: string, resolved: string) {
  const detail = {
    error: 'workspace_denied',
    tool: toolName,
    pat_workspace: bound,
    resolved_workspace: resolved,
    hint: 'This token is scoped to a single workspace. Mint a PAT for the target workspace, or omit the X-Workspace-Id header.',
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
