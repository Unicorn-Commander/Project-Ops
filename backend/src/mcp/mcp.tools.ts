/**
 * Tool implementations for the Project Ops MCP server.
 *
 * Each tool is a thin async function that runs as the *calling user*: the
 * controller pulls the user out of the JWT and passes it in. Permissions are
 * enforced by the same role logic the REST API uses, so an agent can never
 * see anything its user wouldn't.
 */

import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import {
  ApprovalEntityType,
  AutomationTrigger,
  CustomFieldEntity,
  CustomFieldType,
  Prisma,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
  User,
  UserRole,
  WorkspaceRole,
} from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MinioService } from '../documents/minio.service';
import { v4 as uuidv4 } from 'uuid';

// Type-only imports: erased at compile time, so they're safe even when the
// imported services import helpers (e.g. buildVisibilityFilter) back from this
// file — `import type` avoids the runtime cycle.
import type { TriageService } from '../triage/triage.service';
import type { TimerService } from '../time-tracking/timer.service';
import type { TimeEntryService } from '../time-tracking/time-entry.service';
import type { TimesheetService } from '../time-tracking/timesheet.service';
import type { ReportsService } from '../time-tracking/reports.service';
import type { BillableRollupService } from '../time-tracking/billing/billable-rollup.service';
import type { WorkspaceContextService } from '../common/workspace/workspace-context.service';
// Wave 2 services (type-only imports — erased at compile time, so no runtime
// cycle). The MCP tools delegate to these exact services so an agent inherits
// their RBAC + workspace-RLS + validation, identical to the REST controllers.
import type { ReportingService } from '../reporting/reporting.service';
import type { CapacityService } from '../capacity/capacity.service';
import type { AutomationsService } from '../automations/automations.service';
import type { CustomFieldsService } from '../custom-fields/custom-fields.service';
import type { ApprovalsService } from '../client-portal/approvals/approvals.service';
// Member-management spine (invite/role/remove/list). Type-only — erased at
// compile time, so no runtime cycle. Control-plane (non-RLS) service.
import type { WorkspacesService } from '../workspaces/workspaces.service';
import { clampLimit, clampOffset } from '../common/pagination/clamp';

type Logger = { log: (msg: string) => void; warn: (msg: string) => void };

/**
 * Time-tracking service surface injected into ProjectOpsTools so the MCP tools
 * delegate to the exact same code paths as the REST controllers (one source of
 * truth for rate resolution, rounding, approval, and the AO rollup).
 */
export interface TimeTrackingDeps {
  timer: TimerService;
  timeEntry: TimeEntryService;
  timesheet: TimesheetService;
  reports: ReportsService;
  rollup: BillableRollupService;
  workspace: WorkspaceContextService;
}

/**
 * Wave 2 service surface injected into ProjectOpsTools so the reporting /
 * capacity / automations / custom-fields / approvals MCP tools delegate to the
 * SAME services the REST controllers use (one source of truth for RBAC,
 * workspace RLS, and input validation). All optional so the pure-function RBAC
 * unit tests can construct ProjectOpsTools without wiring them; each tool
 * surfaces a clear error if its service wasn't provided.
 */
export interface Wave2Deps {
  reporting: ReportingService;
  capacity: CapacityService;
  automations: AutomationsService;
  customFields: CustomFieldsService;
  approvals: ApprovalsService;
}

// Mime types whose bytes can be returned as text. Office formats are
// included so the LLM at least gets the (often-readable) raw stream;
// truly binary types (images, video, archives) fall through to the
// download-URL branch.
const TEXT_FRIENDLY_MIME_PREFIXES = ['text/'];
const TEXT_FRIENDLY_MIME_TYPES = new Set<string>([
  'application/pdf',
  'application/json',
  'text/markdown',
  'text/csv',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

function isTextFriendlyMime(mime: string): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  if (TEXT_FRIENDLY_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    return true;
  }
  if (TEXT_FRIENDLY_MIME_TYPES.has(lower)) return true;
  if (lower.startsWith('application/vnd.openxmlformats-officedocument.')) return true;
  return false;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
  }
  return Buffer.concat(chunks);
}

export function buildVisibilityFilter(user: User): Prisma.ProjectWhereInput {
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

/**
 * Coerce a free-text `status` filter into a real {@link ProjectStatus} or throw
 * a clear, self-correcting error. Agents (esp. smaller local models) routinely
 * pass natural-language values like "active" or lowercase "new"; without this
 * the raw string reached Prisma and surfaced an opaque
 * `Invalid value for argument status` 500. Case-normalize first so "new" /
 * "in_progress" just work; reject anything still unknown WITH the valid set so
 * the caller can retry. Empty/undefined means "no filter".
 */
export function normalizeProjectStatus(value?: string): ProjectStatus | undefined {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  const normalized = String(value).trim().toUpperCase();
  const valid = Object.values(ProjectStatus) as string[];
  if (valid.includes(normalized)) {
    return normalized as ProjectStatus;
  }
  throw new Error(
    `Invalid status "${value}". Valid values: ${valid.join(', ')}.`,
  );
}

/**
 * Coerce a free-text task `status` filter into a real {@link TaskStatus} or
 * throw a self-correcting error listing valid values. Same agent-forgiving
 * case-normalize path as {@link normalizeProjectStatus}. Empty/undefined =
 * no filter.
 */
export function normalizeTaskStatus(value?: string): TaskStatus | undefined {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  const normalized = String(value).trim().toUpperCase();
  const valid = Object.values(TaskStatus) as string[];
  if (valid.includes(normalized)) {
    return normalized as TaskStatus;
  }
  throw new Error(
    `Invalid task status "${value}". Valid values: ${valid.join(', ')}.`,
  );
}

/**
 * Coerce a free-text task `priority` filter into a real {@link TaskPriority}
 * or throw a self-correcting error. Empty/undefined = no filter.
 */
export function normalizeTaskPriority(value?: string): TaskPriority | undefined {
  if (value === undefined || value === null || String(value).trim() === '') {
    return undefined;
  }
  const normalized = String(value).trim().toUpperCase();
  const valid = Object.values(TaskPriority) as string[];
  if (valid.includes(normalized)) {
    return normalized as TaskPriority;
  }
  throw new Error(
    `Invalid task priority "${value}". Valid values: ${valid.join(', ')}.`,
  );
}

export class ProjectOpsTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly logger: Logger = console,
    private readonly triage?: TriageService,
    private readonly tt?: TimeTrackingDeps,
    private readonly bearerToken: string | null = null,
    private readonly workspace?: WorkspaceContextService,
    // Same global EventEmitter2 the REST TasksService uses. Optional so the
    // pure-function RBAC unit tests can construct the tools without it; when
    // absent, addTaskComment simply skips the (best-effort) domain emit.
    private readonly events?: EventEmitter2,
    // Wave 2 services (reporting / capacity / automations / custom-fields /
    // approvals). Optional for the same reason as the others.
    private readonly wave2?: Wave2Deps,
    // Workspace member-management service (invite / role / remove / list).
    // Optional for the same reason as the others — the pure-function RBAC unit
    // tests construct ProjectOpsTools without it; the member tools surface a
    // clear error if it wasn't wired.
    private readonly workspaceAdmin?: WorkspacesService,
  ) {}

  // ── Workspace (suite tenancy, Phase 2 G2) ────────────────
  // The direct-Prisma tools below (projects, tasks, comments, orgs,
  // documents, billing) own their DB access — unlike the time-tracking +
  // triage tools, which delegate to workspace-aware services. So they must
  // run inside the workspace RLS transaction themselves or, under
  // project_ops_app + flag ON, they hit a NULL GUC and return zero rows /
  // fail WITH CHECK on writes. `runScoped` resolves the caller's active
  // workspace the SAME way C1 established (the PAT-bound `__workspaceClaim`
  // the guard stamps, or the user's active workspace / configured default)
  // and runs `fn` on the GUC-pinned `tx`. RBAC (buildVisibilityFilter et al.)
  // stays inside the callback — it is complementary to RLS, not replaced by
  // it. Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off
  // (membership resolution is a no-op and withWorkspace runs under the
  // BYPASSRLS owner connection).

  /** The WorkspaceContextService is always wired by McpService; surface a
   * clear error rather than a silent fail-open if a caller forgot it. */
  private requireWorkspace(): WorkspaceContextService {
    if (!this.workspace) {
      throw new Error('Workspace context is not enabled on this server');
    }
    return this.workspace;
  }

  /**
   * Resolve the caller's active workspace (explicit token claim → the user's
   * DEFAULT MEMBERSHIP) and run `fn` inside its RLS transaction. We resolve +
   * authorize the id explicitly — identical to what `@CurrentWorkspace`/the PAT
   * chokepoint resolves — and pass it back so `runForUser` re-authorizes
   * membership against that same workspace.
   *
   * The resolved `workspaceId` is also handed to `fn` so write tools can stamp
   * it onto new rows (the scoped columns are NOT NULL with no DB default — the
   * canonical services likewise set `workspaceId` explicitly on create), which
   * also satisfies the RLS WITH CHECK once the flag is on.
   */
  private async runScoped<T>(
    user: User,
    fn: (tx: WorkspaceTxClient, workspaceId: string) => Promise<T>,
  ): Promise<T> {
    const ws = this.requireWorkspace();
    // A claimless human PAT (no `workspace_id` token claim) must resolve to the
    // user's DEFAULT MEMBERSHIP — not the global DEFAULT_WORKSPACE_ID, which
    // 403'd partner users (e.g. Shafen, whose only active membership is Genesis
    // Flow Labs) with "Not a member of the requested workspace". resolveAuthorized
    // authorizes membership and returns the id we pin as the RLS GUC.
    const workspaceId = await ws.resolveAuthorized(user);
    return ws.runForUser(user, (tx) => fn(tx, workspaceId), workspaceId);
  }

  // ── Time tracking tools ──────────────────────────────────
  // Delegate to the time-tracking services so MCP and REST share one code
  // path. Services enforce RBAC, workspace scoping, lock/bill immutability,
  // and rate/rounding rules; they throw on violation (surfaced as tool errors).

  private requireTt(): TimeTrackingDeps {
    if (!this.tt) throw new Error('Time tracking is not enabled on this server');
    return this.tt;
  }

  private workspaceFor(user: User): Promise<string> {
    // Membership-aware, same chokepoint as runScoped / the REST layer: an
    // explicit token claim wins, else the user's DEFAULT MEMBERSHIP — never the
    // global DEFAULT_WORKSPACE_ID. Keeps the time-tracking MCP tools consistent
    // with the read/write tools for partner users (e.g. Shafen in Genesis Flow
    // Labs, whose default membership isn't the env default).
    return this.requireTt().workspace.resolveAuthorized(user);
  }

  async startTimer(
    user: User,
    args: { projectId?: string; taskId?: string; description?: string },
  ) {
    const tt = this.requireTt();
    const res = await tt.timer.startTimer(await this.workspaceFor(user), user, args);
    this.logger.log(`MCP start_timer: user=${user.email}`);
    return res;
  }

  async stopTimer(user: User, _args: Record<string, never>) {
    const tt = this.requireTt();
    const res = await tt.timer.stopTimer(await this.workspaceFor(user), user);
    this.logger.log(`MCP stop_timer: user=${user.email}`);
    return res;
  }

  async logTime(
    user: User,
    args: {
      projectId?: string;
      taskId?: string;
      description?: string;
      startedAt?: string;
      endedAt?: string;
      durationMinutes?: number;
      billable?: boolean;
    },
  ) {
    const tt = this.requireTt();
    const res = await tt.timeEntry.logTime(await this.workspaceFor(user), user, args as any);
    this.logger.log(`MCP log_time: user=${user.email}`);
    return res;
  }

  async updateTimeEntry(user: User, args: { id: string } & Record<string, any>) {
    const { id, ...rest } = args;
    if (!id) throw new Error('id is required');
    const tt = this.requireTt();
    return tt.timeEntry.update(await this.workspaceFor(user), user, id, rest as any);
  }

  async listTimeEntries(user: User, args: Record<string, any>) {
    const tt = this.requireTt();
    return tt.timeEntry.list(await this.workspaceFor(user), user, (args ?? {}) as any);
  }

  async submitTimesheet(user: User, args: { periodStart?: string }) {
    const tt = this.requireTt();
    const res = await tt.timesheet.submit(await this.workspaceFor(user), user, args ?? {});
    this.logger.log(`MCP submit_timesheet: user=${user.email}`);
    return res;
  }

  async approveTime(user: User, args: { timesheetPeriodId?: string; timeEntryIds?: string[] }) {
    const tt = this.requireTt();
    const res = await tt.timesheet.approve(await this.workspaceFor(user), user, args ?? {});
    this.logger.log(`MCP approve_time: user=${user.email}`);
    return res;
  }

  async getUtilization(user: User, args: { from?: string; to?: string; userId?: string }) {
    const tt = this.requireTt();
    return tt.reports.getUtilization(await this.workspaceFor(user), user, args ?? {});
  }

  async createBillableDraft(
    user: User,
    args: {
      projectId?: string;
      clientId?: string;
      periodStart?: string;
      periodEnd?: string;
      groupBy?: string;
      autoSend?: boolean;
    },
  ) {
    const tt = this.requireTt();
    const res = await tt.rollup.createBillableDraft(
      await this.workspaceFor(user),
      user,
      args as any,
      {
        bearerToken: this.bearerToken,
        actingUser: { id: user.id, email: user.email },
      },
    );
    this.logger.log(`MCP create_billable_draft: user=${user.email} status=${(res as any).status}`);
    return res;
  }

  async syncInvoiceStatus(user: User, _args: Record<string, never>) {
    const tt = this.requireTt();
    return tt.rollup.syncInvoiceStatuses(this.bearerToken, {
      workspaceId: await this.workspaceFor(user),
      user,
    });
  }

  async listMyProjects(user: User, args: { status?: string; limit?: number }) {
    const status = normalizeProjectStatus(args.status);
    const where: Prisma.ProjectWhereInput = {
      ...buildVisibilityFilter(user),
      ...(status ? { status } : {}),
    };
    const projects = await this.runScoped(user, (tx) =>
      tx.project.findMany({
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
      }),
    );
    return { projects, count: projects.length };
  }

  async getProject(user: User, args: { id?: string; projectNumber?: string }) {
    if (!args.id && !args.projectNumber) {
      throw new Error('Either id or projectNumber must be provided');
    }
    // Agents routinely put a human project number ("P-00110") in the `id` field
    // (or vice-versa); matching the given key against EITHER column makes the
    // tool forgiving without changing what it can reach. UUIDs and project
    // numbers never collide, so there's no ambiguity. AND-nest so this composes
    // with the visibility filter, which is itself an OR for STAFF/CLIENT.
    const key = (args.id ?? args.projectNumber)!;
    const project = await this.runScoped(user, (tx) =>
      tx.project.findFirst({
        where: {
          AND: [
            buildVisibilityFilter(user),
            { OR: [{ id: key }, { projectNumber: key }] },
          ],
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
      }),
    );
    if (!project) {
      throw new Error(`Project not found or you don't have access`);
    }
    return project;
  }

  async listMyTasks(user: User, args: { status?: string; limit?: number }) {
    const status = normalizeTaskStatus(args.status);
    const tasks = await this.runScoped(user, (tx) =>
      tx.task.findMany({
        where: {
          assignedToId: user.id,
          ...(status ? { status } : {}),
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
      }),
    );
    return { tasks, count: tasks.length };
  }

  /**
   * Full task detail by id. Visibility is project-scoped (same filter as
   * update_task / add_task_comment): the caller must be able to see the
   * parent project. Returns description, status, priority, assignee,
   * project summary, comment/subtask counts, and dependency edges
   * (dependsOn + blocks) when present.
   *
   * Note: `isBlocked` / enforcement of incomplete predecessors is NOT
   * computed here — that lands with feat/p00127-dep-enforcement-and-pats
   * (TasksService.loadBlockedState). Until that merges, agents can infer
   * open blockers from `dependencies.dependsOn` (predecessor status).
   */
  async getTask(user: User, args: { taskId: string }) {
    if (!args.taskId || !String(args.taskId).trim()) {
      throw new Error('taskId is required');
    }
    const taskId = String(args.taskId).trim();

    const result = await this.runScoped(user, async (tx) => {
      const task = await tx.task.findFirst({
        where: {
          id: taskId,
          project: buildVisibilityFilter(user),
        },
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          parentTaskId: true,
          recurrenceRule: true,
          estimatedHours: true,
          metadata: true,
          billable: true,
          createdAt: true,
          updatedAt: true,
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
          parentTask: {
            select: { id: true, title: true, status: true },
          },
          _count: {
            select: { comments: true, subtasks: true },
          },
        },
      });

      if (!task) {
        return null;
      }

      // Dependency edges are cheap (indexed on predecessorId/successorId) and
      // give agents the graph without a second tool round-trip.
      const taskSummary = {
        id: true,
        title: true,
        status: true,
        priority: true,
        projectId: true,
      } as const;
      const [dependsOn, blocks] = await Promise.all([
        tx.taskDependency.findMany({
          where: { successorId: task.id },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            createdAt: true,
            predecessor: { select: taskSummary },
          },
        }),
        tx.taskDependency.findMany({
          where: { predecessorId: task.id },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            type: true,
            createdAt: true,
            successor: { select: taskSummary },
          },
        }),
      ]);

      return {
        ...task,
        commentsCount: task._count.comments,
        subtasksCount: task._count.subtasks,
        dependencies: { dependsOn, blocks },
      };
    });

    if (!result) {
      throw new Error('Task not found or you don\'t have access');
    }
    // Drop the raw Prisma _count bag now that we flattened the counters.
    const { _count: _ignored, ...task } = result as typeof result & { _count?: unknown };
    return task;
  }

  /**
   * List tasks on one project the caller can see. Identify the project by
   * `projectId` or `projectNumber` (same dual-key forgiveness as get_project:
   * either arg may hold a UUID or a human project number).
   *
   * Window (explicit): offset/limit pagination.
   *   - `limit` defaults to 25, hard-capped at 100
   *   - `offset` defaults to 0
   *   - ordered by priority desc, dueDate asc, createdAt desc (matches REST
   *     TasksService.findAll default)
   * Optional filters: `status` (TaskStatus), `priority` (TaskPriority) —
   * case-normalized; unknown values throw a self-correcting error.
   *
   * Returns `{ project, tasks, count, total, offset, limit }` where `count`
   * is the page size returned and `total` is the full match count for the
   * filters (so agents can page).
   */
  async listProjectTasks(
    user: User,
    args: {
      projectId?: string;
      projectNumber?: string;
      status?: string;
      priority?: string;
      limit?: number;
      offset?: number;
    },
  ) {
    if (!args.projectId && !args.projectNumber) {
      throw new Error('Either projectId or projectNumber must be provided');
    }
    const status = normalizeTaskStatus(args.status);
    const priority = normalizeTaskPriority(args.priority);
    const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 25)), 100);
    const offset = Math.max(0, Math.floor(args.offset ?? 0));

    // Dual-key: whichever of projectId/projectNumber the agent filled, match
    // against EITHER column (UUIDs and project numbers never collide).
    const key = (args.projectId ?? args.projectNumber)!;

    const result = await this.runScoped(user, async (tx) => {
      const project = await tx.project.findFirst({
        where: {
          AND: [
            buildVisibilityFilter(user),
            { OR: [{ id: key }, { projectNumber: key }] },
          ],
        },
        select: { id: true, projectNumber: true, title: true, status: true },
      });
      if (!project) {
        return null;
      }

      const where: Prisma.TaskWhereInput = {
        projectId: project.id,
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
      };

      const [tasks, total] = await Promise.all([
        tx.task.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            status: true,
            priority: true,
            dueDate: true,
            completedAt: true,
            estimatedHours: true,
            parentTaskId: true,
            createdAt: true,
            updatedAt: true,
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            createdBy: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            _count: { select: { comments: true, subtasks: true } },
          },
        }),
        tx.task.count({ where }),
      ]);

      return {
        project,
        tasks: tasks.map(({ _count, ...t }) => ({
          ...t,
          commentsCount: _count.comments,
          subtasksCount: _count.subtasks,
        })),
        total,
      };
    });

    if (!result) {
      throw new Error('Project not found or you don\'t have access');
    }

    return {
      project: result.project,
      tasks: result.tasks,
      count: result.tasks.length,
      total: result.total,
      offset,
      limit,
    };
  }

  async searchProjects(user: User, args: { query: string; limit?: number }) {
    const q = (args.query ?? '').trim();
    if (!q) {
      throw new Error('query is required');
    }
    const projects = await this.runScoped(user, (tx) =>
      tx.project.findMany({
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
      }),
    );
    return { projects, count: projects.length };
  }

  async getRecentActivity(user: User, args: { limit?: number }) {
    const visibility = buildVisibilityFilter(user);
    const limit = Math.min(args.limit ?? 20, 50);
    // R4: both queries run in ONE workspace tx (one GUC scope) so the
    // activity view is a consistent snapshot of the active workspace.
    const [comments, taskUpdates] = await this.runScoped(user, (tx) =>
      Promise.all([
        tx.comment.findMany({
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
        tx.task.findMany({
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
      ]),
    );
    return { recent_comments: comments, recent_task_updates: taskUpdates };
  }

  async addTaskComment(user: User, args: { taskId: string; content: string }) {
    // Capture the resolved workspace + created comment so we can emit the
    // domain event AFTER the tx commits (mirrors TasksService.addComment).
    const { comment, workspaceId } = await this.runScoped(user, async (tx, workspaceId) => {
      const task = await tx.task.findFirst({
        where: {
          id: args.taskId,
          project: buildVisibilityFilter(user),
        },
        select: { id: true, projectId: true },
      });
      if (!task) {
        throw new Error("Task not found or you don't have access");
      }
      const created = await tx.taskComment.create({
        data: {
          taskId: task.id,
          // Stamp the active workspace — RLS WITH CHECK rejects a NULL
          // workspaceId row (this was the one MCP create missing it; caught
          // live by the fence on 2026-06-10).
          workspaceId,
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
      return { comment: created, workspaceId };
    });

    // Domain event for downstream @mention fan-out (notifications module).
    // Emitted OUTSIDE the workspace tx so a listener that re-queries the DB
    // sees a committed row and a slow/failing listener can never hold or roll
    // back the comment write. Payload matches TasksService.addComment exactly
    // so MCP-posted comments fan out @mentions identically. (Optional emitter:
    // skipped only in the pure RBAC unit tests that don't wire one.)
    this.events?.emit('task.comment.created', {
      workspaceId,
      taskId: args.taskId,
      commentId: comment.id,
      authorId: user.id,
      content: comment.content,
    });

    return comment;
  }

  /**
   * List comments on a task the caller can see (project visibility filter),
   * oldest first. Paginated: `limit` defaults to 50 (max 100), `offset` to 0.
   * Mirrors REST TasksService.getTaskComments + the MCP visibility chokepoint
   * used by add_task_comment.
   */
  async listTaskComments(
    user: User,
    args: { taskId: string; limit?: number; offset?: number },
  ) {
    if (!args.taskId || !String(args.taskId).trim()) {
      throw new Error('taskId is required');
    }
    const taskId = String(args.taskId).trim();
    const take = clampLimit(args.limit, 50);
    const skip = clampOffset(args.offset);

    return this.runScoped(user, async (tx) => {
      const task = await tx.task.findFirst({
        where: {
          id: taskId,
          project: buildVisibilityFilter(user),
        },
        select: { id: true },
      });
      if (!task) {
        throw new Error("Task not found or you don't have access");
      }

      const where = { taskId: task.id };
      const [comments, total] = await Promise.all([
        tx.taskComment.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          skip,
          take,
          select: {
            id: true,
            taskId: true,
            content: true,
            createdAt: true,
            updatedAt: true,
            authorId: true,
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
        tx.taskComment.count({ where }),
      ]);

      return {
        taskId: task.id,
        comments,
        total,
        limit: take,
        offset: skip,
        count: comments.length,
      };
    });
  }

  /**
   * Update a task comment. Same ownership as REST TasksService.updateComment /
   * project-comment UI: author or ADMIN. Parent-task visibility is enforced
   * via buildVisibilityFilter (stricter for STAFF than workspace-RLS alone).
   * No @mention re-emit — REST update also does not re-fan-out mentions.
   */
  async updateTaskComment(
    user: User,
    args: { commentId: string; content: string },
  ) {
    if (!args.commentId || !String(args.commentId).trim()) {
      throw new Error('commentId is required');
    }
    const content = (args.content ?? '').trim();
    if (!content) {
      throw new Error('content is required');
    }
    if (content.length > 5000) {
      throw new Error('content must be at most 5000 characters');
    }

    const updated = await this.runScoped(user, async (tx) => {
      const comment = await tx.taskComment.findFirst({
        where: {
          id: String(args.commentId).trim(),
          task: { project: buildVisibilityFilter(user) },
        },
        select: { id: true, authorId: true, taskId: true },
      });
      if (!comment) {
        throw new Error("Comment not found or you don't have access");
      }

      const canEdit =
        comment.authorId === user.id || user.role === UserRole.ADMIN;
      if (!canEdit) {
        throw new Error('Only the author or an ADMIN can update this comment');
      }

      const row = await tx.taskComment.update({
        where: { id: comment.id },
        data: { content },
        select: {
          id: true,
          taskId: true,
          content: true,
          createdAt: true,
          updatedAt: true,
          authorId: true,
          author: { select: { firstName: true, lastName: true } },
        },
      });
      this.logger.log(
        `MCP update_task_comment: user=${user.email} comment=${comment.id}`,
      );
      return row;
    });

    return updated;
  }

  /**
   * Delete a task comment. Same ownership as REST TasksService.removeComment /
   * project-comment UI: author, ADMIN, or MANAGER. Visibility via parent task.
   */
  async deleteTaskComment(user: User, args: { commentId: string }) {
    if (!args.commentId || !String(args.commentId).trim()) {
      throw new Error('commentId is required');
    }

    return this.runScoped(user, async (tx) => {
      const comment = await tx.taskComment.findFirst({
        where: {
          id: String(args.commentId).trim(),
          task: { project: buildVisibilityFilter(user) },
        },
        select: { id: true, authorId: true, taskId: true },
      });
      if (!comment) {
        throw new Error("Comment not found or you don't have access");
      }

      const canDelete =
        comment.authorId === user.id ||
        user.role === UserRole.ADMIN ||
        user.role === UserRole.MANAGER;
      if (!canDelete) {
        throw new Error(
          'Only the author, ADMIN, or MANAGER can delete this comment',
        );
      }

      await tx.taskComment.delete({ where: { id: comment.id } });
      this.logger.log(
        `MCP delete_task_comment: user=${user.email} comment=${comment.id}`,
      );
      return { deleted: true, commentId: comment.id, taskId: comment.taskId };
    });
  }

  // ─────────────────────────────────────────────────────────────────────
  // Write tools — schema-validated, RBAC enforced
  // Mirrors the existing REST endpoints. Only allow ADMIN / MANAGER /
  // STAFF to create or change state; CLIENT users are read-only.
  // ─────────────────────────────────────────────────────────────────────

  // Exposed for testing — same behaviour as before.
  assertCanWrite(user: User) {
    if (user.role === UserRole.CLIENT) {
      throw new Error('Read-only role — clients cannot create or update.');
    }
  }

  // Org creation mirrors the REST endpoint's @Roles(ADMIN, MANAGER) guard.
  assertCanManageOrgs(user: User) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
      throw new Error('Only ADMIN or MANAGER roles can create organizations.');
    }
  }

  async listOrganizations(user: User, args: { type?: string; isActive?: boolean; limit?: number }) {
    const where: Prisma.OrganizationWhereInput = {
      ...(args.type ? { type: args.type.toUpperCase() as any } : {}),
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    };
    const result = await this.runScoped(user, async (tx) => {
      // CLIENTs only see orgs they're a contact in (matches REST org tree filter).
      if (user.role === UserRole.CLIENT) {
        const contact = await tx.contact.findFirst({
          where: { userId: user.id },
          select: { organizationId: true },
        });
        if (!contact?.organizationId) return [] as any[];
        where.id = contact.organizationId;
      }
      return tx.organization.findMany({
        where,
        take: Math.min(args.limit ?? 50, 100),
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          parentOrgId: true,
          portalAccessEnabled: true,
          createdAt: true,
          _count: { select: { projects: true, childOrgs: true } },
        },
      });
    });
    return { organizations: result, count: result.length };
  }

  async getOrganization(user: User, args: { id: string }) {
    if (!args.id) throw new Error("'id' is required.");
    const organization = await this.runScoped(user, async (tx) => {
      if (user.role === UserRole.CLIENT) {
        const contact = await tx.contact.findFirst({
          where: { userId: user.id, organizationId: args.id },
          select: { id: true },
        });
        if (!contact) throw new Error('Organization not found or no access.');
      }
      return tx.organization.findUnique({
        where: { id: args.id },
        include: {
          parentOrg: { select: { id: true, name: true, type: true } },
          childOrgs: { select: { id: true, name: true, type: true, isActive: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          _count: { select: { projects: true, contacts: true } },
        },
      });
    });
    if (!organization) throw new Error('Organization not found.');
    return organization;
  }

  async updateOrganization(
    user: User,
    args: {
      id: string;
      name?: string;
      type?: string;
      taxId?: string | null;
      industry?: string | null;
      website?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      zipCode?: string | null;
      country?: string | null;
      parentOrgId?: string | null;
      portalAccessEnabled?: boolean;
      isActive?: boolean;
      notes?: string | null;
    },
  ) {
    this.assertCanManageOrgs(user);
    if (!args.id) throw new Error("'id' is required.");

    if (args.type) {
      const validTypes = ['AGENCY', 'BUSINESS', 'INDIVIDUAL', 'PARTNER'];
      if (!validTypes.includes(args.type.toUpperCase())) {
        throw new Error(`Invalid type '${args.type}'. Must be one of: ${validTypes.join(', ')}.`);
      }
    }
    if (args.parentOrgId && args.parentOrgId === args.id) {
      throw new Error('Organization cannot be its own parent.');
    }

    const data: Prisma.OrganizationUpdateInput = {};
    if (args.name !== undefined) data.name = args.name;
    if (args.type !== undefined) data.type = args.type.toUpperCase() as any;
    if (args.taxId !== undefined) data.taxId = args.taxId;
    if (args.industry !== undefined) data.industry = args.industry;
    if (args.website !== undefined) data.website = args.website;
    if (args.address !== undefined) data.address = args.address;
    if (args.city !== undefined) data.city = args.city;
    if (args.state !== undefined) data.state = args.state;
    if (args.zipCode !== undefined) data.zipCode = args.zipCode;
    if (args.country !== undefined) data.country = args.country;
    if (args.parentOrgId !== undefined) {
      data.parentOrg = args.parentOrgId
        ? { connect: { id: args.parentOrgId } }
        : { disconnect: true };
    }
    if (args.portalAccessEnabled !== undefined) {
      data.portalAccessEnabled = args.portalAccessEnabled;
    }
    if (args.isActive !== undefined) data.isActive = args.isActive;
    if (args.notes !== undefined) data.notes = args.notes;

    const updated = await this.runScoped(user, async (tx) => {
      const existing = await tx.organization.findUnique({
        where: { id: args.id },
        select: { id: true },
      });
      if (!existing) throw new Error(`Organization '${args.id}' not found.`);

      if (args.parentOrgId) {
        const parent = await tx.organization.findUnique({
          where: { id: args.parentOrgId },
          select: { id: true },
        });
        if (!parent) {
          throw new Error(`Parent organization '${args.parentOrgId}' not found.`);
        }
      }

      return tx.organization.update({
        where: { id: args.id },
        data,
        select: {
          id: true,
          name: true,
          type: true,
          isActive: true,
          parentOrgId: true,
          portalAccessEnabled: true,
          updatedAt: true,
        },
      });
    });
    this.logger.log(`MCP update_organization: user=${user.email} org=${updated.id}`);
    return updated;
  }

  async createOrganization(
    user: User,
    args: {
      name: string;
      type: string;
      taxId?: string;
      industry?: string;
      website?: string;
      address?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
      parentOrgId?: string;
      portalAccessEnabled?: boolean;
      notes?: string;
    },
  ) {
    this.assertCanManageOrgs(user);

    const validTypes = ['AGENCY', 'BUSINESS', 'INDIVIDUAL', 'PARTNER'];
    const type = (args.type || '').toUpperCase();
    if (!validTypes.includes(type)) {
      throw new Error(`Invalid type '${args.type}'. Must be one of: ${validTypes.join(', ')}.`);
    }

    const organization = await this.runScoped(user, async (tx, workspaceId) => {
      if (args.parentOrgId) {
        const parent = await tx.organization.findUnique({
          where: { id: args.parentOrgId },
          select: { id: true },
        });
        if (!parent) {
          throw new Error(`Parent organization '${args.parentOrgId}' not found.`);
        }
      }

      return tx.organization.create({
        data: {
          workspaceId,
          name: args.name,
          type: type as any,
          taxId: args.taxId,
          industry: args.industry,
          website: args.website,
          address: args.address,
          city: args.city,
          state: args.state,
          zipCode: args.zipCode,
          country: args.country ?? 'USA',
          parentOrgId: args.parentOrgId,
          portalAccessEnabled: args.portalAccessEnabled ?? false,
          notes: args.notes,
          createdById: user.id,
        },
        select: {
          id: true,
          name: true,
          type: true,
          parentOrgId: true,
          portalAccessEnabled: true,
          isActive: true,
          createdAt: true,
        },
      });
    });

    this.logger.log(
      `MCP create_organization: user=${user.email} org=${organization.id} type=${organization.type}`,
    );
    return organization;
  }

  async createProject(
    user: User,
    args: {
      title: string;
      description?: string;
      clientName: string;
      organizationId?: string;
      priority?: string;
      dueDate?: string;
      assignedToId?: string;
      // Wave 2 pass-throughs — handled as ProjectsService does. customFields are
      // validated against the workspace PROJECT definitions and folded into
      // metadata.customFields; recurrenceRule (RRULE) is a plain column.
      // (Projects have no estimatedHours.)
      customFields?: Record<string, any>;
      recurrenceRule?: string;
    },
  ) {
    this.assertCanWrite(user);
    // The project-number sequence + the insert run in ONE workspace tx so the
    // number is computed against the workspace-scoped row set (matching the
    // REST createInTx path) and is consistent with the row being created.
    const project = await this.runScoped(user, async (tx, workspaceId) => {
      const last = await tx.project.findFirst({
        where: { projectNumber: { startsWith: 'P-' } },
        orderBy: { projectNumber: 'desc' },
        select: { projectNumber: true },
      });
      const next =
        last?.projectNumber?.match(/^P-(\d+)$/)?.[1] !== undefined
          ? parseInt(last!.projectNumber!.match(/^P-(\d+)$/)![1], 10) + 1
          : 1;
      const projectNumber = `P-${String(next).padStart(5, '0')}`;
      const metadata = await this.resolveProjectMetadata(tx, workspaceId, {}, args.customFields);
      return tx.project.create({
        data: {
          workspaceId,
          projectNumber,
          title: args.title,
          description: args.description,
          clientName: args.clientName,
          organizationId: args.organizationId,
          priority: (args.priority as any) ?? 'MEDIUM',
          dueDate: args.dueDate ? new Date(args.dueDate) : null,
          ...(args.recurrenceRule !== undefined ? { recurrenceRule: args.recurrenceRule } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          createdById: user.id,
          assignedToId: args.assignedToId ?? user.id,
        },
        select: {
          id: true,
          projectNumber: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          recurrenceRule: true,
          metadata: true,
        },
      });
    });
    this.logger.log(`MCP create_project: user=${user.email} project=${project.projectNumber}`);
    return project;
  }

  async updateProjectStatus(
    user: User,
    args: { id?: string; projectNumber?: string; status: string },
  ) {
    this.assertCanWrite(user);
    if (!args.id && !args.projectNumber) {
      throw new Error('Either id or projectNumber must be provided');
    }
    const updated = await this.runScoped(user, async (tx) => {
      const found = await tx.project.findFirst({
        where: {
          ...buildVisibilityFilter(user),
          ...(args.id ? { id: args.id } : { projectNumber: args.projectNumber! }),
        },
        select: { id: true, projectNumber: true },
      });
      if (!found) {
        throw new Error('Project not found or no access');
      }
      return tx.project.update({
        where: { id: found.id },
        data: {
          status: args.status as any,
          ...(args.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
        select: { id: true, projectNumber: true, status: true, completedAt: true },
      });
    });
    this.logger.log(
      `MCP update_project_status: user=${user.email} project=${updated.projectNumber} → ${updated.status}`,
    );
    return updated;
  }

  async updateProject(
    user: User,
    args: {
      id?: string;
      projectNumber?: string;
      title?: string;
      description?: string;
      clientName?: string;
      organizationId?: string | null;
      priority?: string;
      dueDate?: string | null;
      assignedToId?: string;
      // Wave 2 pass-throughs (see createProject).
      customFields?: Record<string, any>;
      recurrenceRule?: string | null;
    },
  ) {
    this.assertCanWrite(user);
    if (!args.id && !args.projectNumber) {
      throw new Error('Either id or projectNumber must be provided');
    }

    const data: Prisma.ProjectUpdateInput = {};
    if (args.title !== undefined) data.title = args.title;
    if (args.description !== undefined) data.description = args.description;
    if (args.clientName !== undefined) data.clientName = args.clientName;
    if (args.organizationId !== undefined) {
      data.organization = args.organizationId
        ? { connect: { id: args.organizationId } }
        : { disconnect: true };
    }
    if (args.priority !== undefined) data.priority = args.priority as any;
    if (args.dueDate !== undefined) {
      data.dueDate = args.dueDate ? new Date(args.dueDate) : null;
    }
    if (args.assignedToId !== undefined) {
      data.assignedTo = { connect: { id: args.assignedToId } };
    }
    if (args.recurrenceRule !== undefined) data.recurrenceRule = args.recurrenceRule;

    const updated = await this.runScoped(user, async (tx, workspaceId) => {
      const found = await tx.project.findFirst({
        where: {
          ...buildVisibilityFilter(user),
          ...(args.id ? { id: args.id } : { projectNumber: args.projectNumber! }),
        },
        select: { id: true, projectNumber: true, metadata: true },
      });
      if (!found) {
        throw new Error('Project not found or no access');
      }

      if (args.organizationId) {
        const org = await tx.organization.findUnique({
          where: { id: args.organizationId },
          select: { id: true },
        });
        if (!org) {
          throw new Error(`Organization '${args.organizationId}' not found.`);
        }
      }

      if (args.customFields !== undefined) {
        const merged = await this.resolveProjectMetadata(
          tx,
          workspaceId,
          found.metadata,
          args.customFields,
        );
        if (merged !== undefined) data.metadata = merged;
      }

      return tx.project.update({
        where: { id: found.id },
        data,
        select: {
          id: true,
          projectNumber: true,
          title: true,
          clientName: true,
          priority: true,
          dueDate: true,
          recurrenceRule: true,
          metadata: true,
          organization: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
    this.logger.log(`MCP update_project: user=${user.email} project=${updated.projectNumber}`);
    return updated;
  }

  async updateTask(
    user: User,
    args: {
      taskId: string;
      title?: string;
      description?: string;
      type?: string;
      priority?: string;
      dueDate?: string | null;
      assignedToId?: string;
      projectId?: string;
      projectNumber?: string;
      // Wave 2 pass-throughs (see createTask).
      customFields?: Record<string, any>;
      recurrenceRule?: string | null;
      estimatedHours?: number | null;
    },
  ) {
    this.assertCanWrite(user);

    const data: Prisma.TaskUpdateInput = {};
    if (args.title !== undefined) data.title = args.title;
    if (args.description !== undefined) data.description = args.description;
    if (args.type !== undefined) data.type = args.type as any;
    if (args.priority !== undefined) data.priority = args.priority as any;
    if (args.dueDate !== undefined) {
      data.dueDate = args.dueDate ? new Date(args.dueDate) : null;
    }
    if (args.assignedToId !== undefined) {
      data.assignedTo = { connect: { id: args.assignedToId } };
    }
    if (args.recurrenceRule !== undefined) data.recurrenceRule = args.recurrenceRule;
    if (args.estimatedHours !== undefined) data.estimatedHours = args.estimatedHours;

    const updated = await this.runScoped(user, async (tx, workspaceId) => {
      const found = await tx.task.findFirst({
        where: {
          id: args.taskId,
          project: buildVisibilityFilter(user),
        },
        select: { id: true, projectId: true, metadata: true },
      });
      if (!found) {
        throw new Error('Task not found or no access');
      }

      if (args.projectId || args.projectNumber) {
        const target = await tx.project.findFirst({
          where: {
            ...buildVisibilityFilter(user),
            ...(args.projectId ? { id: args.projectId } : { projectNumber: args.projectNumber! }),
          },
          select: { id: true },
        });
        if (!target) {
          throw new Error('Target project not found or no access');
        }
        data.project = { connect: { id: target.id } };
      }

      // Custom-field VALUES: validate on this tx and merge into the EXISTING
      // metadata (read-modify-write) so other metadata keys are preserved.
      if (args.customFields !== undefined) {
        const merged = await this.resolveTaskMetadata(
          tx,
          workspaceId,
          found.metadata,
          args.customFields,
        );
        if (merged !== undefined) data.metadata = merged;
      }

      return tx.task.update({
        where: { id: found.id },
        data,
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          recurrenceRule: true,
          estimatedHours: true,
          metadata: true,
          project: { select: { id: true, projectNumber: true, title: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      });
    });
    this.logger.log(
      `MCP update_task: user=${user.email} task=${updated.id} project=${updated.project.projectNumber}`,
    );
    return updated;
  }

  async createTask(
    user: User,
    args: {
      projectId?: string;
      projectNumber?: string;
      title: string;
      description?: string;
      type?: string;
      priority?: string;
      dueDate?: string;
      assignedToId?: string;
      /**
       * Optional parent for subtasks. Validated the same way as
       * TasksService.createInTx: parent must resolve under the workspace RLS
       * tx (other workspaces are invisible → not-found) and must belong to
       * the same project as the new task (subtasks don't cross projects).
       */
      parentTaskId?: string;
      // Wave 2 pass-throughs — handled exactly as TasksService does:
      // customFields are validated against the workspace TASK definitions and
      // folded into metadata.customFields; recurrenceRule (RRULE) + estimatedHours
      // are plain columns.
      customFields?: Record<string, any>;
      recurrenceRule?: string;
      estimatedHours?: number;
    },
  ) {
    this.assertCanWrite(user);
    if (!args.projectId && !args.projectNumber) {
      throw new Error('Either projectId or projectNumber must be provided');
    }
    const parentTaskId =
      args.parentTaskId !== undefined && args.parentTaskId !== null
        ? String(args.parentTaskId).trim() || undefined
        : undefined;
    const { task, projectNumber } = await this.runScoped(user, async (tx, workspaceId) => {
      const project = await tx.project.findFirst({
        where: {
          ...buildVisibilityFilter(user),
          ...(args.projectId ? { id: args.projectId } : { projectNumber: args.projectNumber! }),
        },
        select: { id: true, projectNumber: true },
      });
      if (!project) {
        throw new Error('Project not found or no access');
      }

      // Mirror TasksService.createInTx parent validation: workspace RLS makes
      // cross-workspace parents invisible (not-found); same-project is explicit.
      if (parentTaskId) {
        const parent = await tx.task.findUnique({
          where: { id: parentTaskId },
          select: { id: true, projectId: true },
        });
        if (!parent) {
          throw new Error(`Parent task with ID ${parentTaskId} not found`);
        }
        if (parent.projectId !== project.id) {
          throw new Error('Parent task must belong to the same project as the subtask');
        }
      }

      // Validate + fold custom-field VALUES on the SAME workspace tx (the
      // CustomFieldsValidator contract requires the caller's tx so the
      // definitions read stays under one RLS scope). New task → no existing
      // metadata, so the base is empty.
      const metadata = await this.resolveTaskMetadata(tx, workspaceId, {}, args.customFields);
      const created = await tx.task.create({
        data: {
          workspaceId,
          projectId: project.id,
          title: args.title,
          description: args.description,
          type: (args.type as any) ?? 'OTHER',
          priority: (args.priority as any) ?? 'MEDIUM',
          dueDate: args.dueDate ? new Date(args.dueDate) : null,
          ...(parentTaskId ? { parentTaskId } : {}),
          ...(args.recurrenceRule !== undefined ? { recurrenceRule: args.recurrenceRule } : {}),
          ...(args.estimatedHours !== undefined ? { estimatedHours: args.estimatedHours } : {}),
          ...(metadata !== undefined ? { metadata } : {}),
          createdById: user.id,
          assignedToId: args.assignedToId ?? user.id,
        },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          parentTaskId: true,
          recurrenceRule: true,
          estimatedHours: true,
          metadata: true,
          project: { select: { projectNumber: true, title: true } },
        },
      });
      return { task: created, projectNumber: project.projectNumber };
    });
    this.logger.log(
      `MCP create_task: user=${user.email} project=${projectNumber} task=${task.id}` +
        (parentTaskId ? ` parent=${parentTaskId}` : ''),
    );
    return task;
  }

  /**
   * List direct subtasks of a parent task. Mirrors REST TasksService.getSubtasks:
   * parent must be visible via its project (buildVisibilityFilter); returns
   * ordered children with assignee/creator + nested comment/subtask counts.
   */
  async listTaskSubtasks(user: User, args: { taskId: string }) {
    if (!args.taskId || !String(args.taskId).trim()) {
      throw new Error('taskId is required');
    }
    const taskId = String(args.taskId).trim();

    const result = await this.runScoped(user, async (tx) => {
      const parent = await tx.task.findFirst({
        where: {
          id: taskId,
          project: buildVisibilityFilter(user),
        },
        select: {
          id: true,
          title: true,
          status: true,
          project: {
            select: { id: true, projectNumber: true, title: true },
          },
        },
      });
      if (!parent) {
        return null;
      }

      const subtasks = await tx.task.findMany({
        where: { parentTaskId: parent.id },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          estimatedHours: true,
          parentTaskId: true,
          createdAt: true,
          updatedAt: true,
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
            select: { comments: true, subtasks: true },
          },
        },
      });

      return {
        parent: {
          id: parent.id,
          title: parent.title,
          status: parent.status,
          project: parent.project,
        },
        subtasks: subtasks.map(({ _count, ...t }) => ({
          ...t,
          commentsCount: _count.comments,
          subtasksCount: _count.subtasks,
        })),
      };
    });

    if (!result) {
      throw new Error('Task not found or you don\'t have access');
    }

    return {
      parent: result.parent,
      subtasks: result.subtasks,
      count: result.subtasks.length,
    };
  }

  /**
   * Ingest candidate action items from an external agent (Meeting-Ops, etc.)
   * into the PO triage agent. Propose-only: the TriageService writes
   * TriageProposal rows for human review — no tasks/projects are created
   * here. Idempotent on (sourceType, sourceActionItemId). CLIENT-role users
   * cannot call this.
   */
  async submitCandidateActionItems(
    user: User,
    args: {
      items: Array<{ text: string; owner?: string; sourceActionItemId?: string }>;
      sourceType?: string;
    },
  ) {
    this.assertCanWrite(user);
    if (!this.triage) {
      throw new Error('Triage is not enabled on this server');
    }
    const items = (args.items ?? []).map((it) => ({
      text: it.text,
      owner: it.owner,
      sourceActionItemId: it.sourceActionItemId,
      sourceType: args.sourceType,
    }));
    this.logger.log(
      `MCP submit_candidate_action_items: user=${user.email} items=${items.length} sourceType=${args.sourceType ?? 'MANUAL'}`,
    );
    // Membership-aware chokepoint (claim → DEFAULT MEMBERSHIP), identical to
    // runScoped / @CurrentWorkspace / every other MCP write. The previous
    // resolveWorkspaceId(user, DEFAULT_WORKSPACE_ID) path forced partner users
    // whose only membership is not the env default through the wrong workspace
    // (then 403'd inside triage runForUser) — same class of bug the time-tracking
    // tools already fixed. triage.ingestCandidates re-authorizes via runForUser.
    const workspaceId = await this.requireWorkspace().resolveAuthorized(user);
    return this.triage.ingestCandidates(workspaceId, user, items);
  }

  async updateTaskStatus(user: User, args: { taskId: string; status: string }) {
    this.assertCanWrite(user);
    const updated = await this.runScoped(user, async (tx) => {
      const found = await tx.task.findFirst({
        where: {
          id: args.taskId,
          project: buildVisibilityFilter(user),
        },
        select: { id: true },
      });
      if (!found) {
        throw new Error('Task not found or no access');
      }
      return tx.task.update({
        where: { id: found.id },
        data: {
          status: args.status as any,
          ...(args.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
        select: { id: true, title: true, status: true, completedAt: true },
      });
    });
    this.logger.log(
      `MCP update_task_status: user=${user.email} task=${updated.id} → ${updated.status}`,
    );
    return updated;
  }

  /**
   * Permanently delete a task. Mirrors REST `DELETE /tasks/:id`
   * (`TasksController.remove` @Roles(UserRole.ADMIN) + `TasksService.remove`):
   * ADMIN only — not STAFF/MANAGER/CLIENT. Visibility is checked first via
   * runScoped + project filter (defense in depth; ADMIN filter is open).
   *
   * Intentional asymmetry vs `archive_project`: project hard-delete is NOT
   * exposed to agents (archive is the safe reversible alternative). Task
   * hard-delete IS exposed because REST already allows it for ADMIN and
   * agents need cleanup of mistaken creates. Projects cascade more and are
   * irreversible in ways tasks are not treated as.
   */
  async deleteTask(user: User, args: { taskId: string }) {
    this.assertAdmin(user, 'delete tasks');
    if (!args?.taskId) {
      throw new Error("'taskId' is required.");
    }
    const result = await this.runScoped(user, async (tx) => {
      const found = await tx.task.findFirst({
        where: {
          id: args.taskId,
          project: buildVisibilityFilter(user),
        },
        select: { id: true },
      });
      if (!found) {
        throw new Error('Task not found or no access');
      }
      await tx.task.delete({ where: { id: found.id } });
      return { message: 'Task deleted successfully', id: found.id };
    });
    this.logger.log(`MCP delete_task: user=${user.email} task=${result.id}`);
    return result;
  }

  async listProjectDocuments(user: User, args: { projectId?: string; projectNumber?: string }) {
    if (!args.projectId && !args.projectNumber) {
      throw new Error('Either projectId or projectNumber must be provided');
    }
    const { project, documents } = await this.runScoped(user, async (tx) => {
      const proj = await tx.project.findFirst({
        where: {
          ...buildVisibilityFilter(user),
          ...(args.projectId ? { id: args.projectId } : { projectNumber: args.projectNumber! }),
        },
        select: { id: true, projectNumber: true },
      });
      if (!proj) {
        throw new Error('Project not found or no access');
      }
      const docs = await tx.document.findMany({
        where: { projectId: proj.id },
        orderBy: { uploadedAt: 'desc' },
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          status: true,
          description: true,
          uploadedAt: true,
          uploadedBy: { select: { firstName: true, lastName: true } },
        },
      });
      return { project: proj, documents: docs };
    });
    return { project, documents, count: documents.length };
  }

  /**
   * Fetch a document's bytes from MinIO and return text content when the mime
   * type is text-friendly. For PDFs we attempt `pdf-parse` (lazy require so a
   * missing dep degrades gracefully) and fall back to a presigned download
   * URL if extraction fails or the dep isn't installed. Binary mime types
   * always return `{ supported: false, downloadUrl }` so the LLM hands the
   * user a link instead of trying to render.
   *
   * Output cap: 50KB of text, then truncated marker. Visibility is enforced
   * via buildVisibilityFilter on the parent project; orphan documents (no
   * project) are admin-only.
   */
  async getDocumentContent(
    user: User,
    args: { documentId?: string; fileName?: string; projectNumber?: string },
  ) {
    const TEXT_CAP = 50 * 1024;

    if (!args.documentId && !(args.fileName && args.projectNumber)) {
      throw new Error("Provide 'documentId', or both 'fileName' and 'projectNumber'.");
    }

    // Metadata lookup runs inside the workspace tx; the MinIO byte I/O below
    // stays OUTSIDE it (B4 — never hold a DB transaction open across object
    // storage round-trips).
    const document = await this.runScoped(user, (tx) => {
      if (args.documentId) {
        return tx.document.findFirst({
          where: {
            id: args.documentId,
            OR: [
              { project: buildVisibilityFilter(user) },
              // orphan docs (no project) only visible to admins / managers
              ...(user.role === UserRole.ADMIN || user.role === UserRole.MANAGER
                ? [{ projectId: null }]
                : []),
            ],
          },
        });
      }
      return tx.document.findFirst({
        where: {
          fileName: args.fileName!,
          project: {
            ...buildVisibilityFilter(user),
            projectNumber: args.projectNumber!,
          },
        },
        orderBy: { uploadedAt: 'desc' },
      });
    });

    if (!document) {
      throw new Error("Document not found or you don't have access");
    }

    const downloadUrl = await this.minio.getPresignedDownloadUrl(document.s3Key, 3600);

    const mime = (document.mimeType || '').toLowerCase();

    if (!isTextFriendlyMime(mime)) {
      return {
        documentId: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        fileSize: document.fileSize,
        supported: false,
        downloadUrl,
        note: 'Mime type is not text-friendly — hand the user the downloadUrl.',
      };
    }

    let buffer: Buffer;
    try {
      const stream = await this.minio.getObjectStream(document.s3Key);
      buffer = await streamToBuffer(stream);
    } catch (err) {
      this.logger.warn(
        `MCP get_document_content: stream failed for ${document.id}: ${(err as Error).message}`,
      );
      return {
        documentId: document.id,
        fileName: document.fileName,
        mimeType: document.mimeType,
        supported: false,
        downloadUrl,
        note: 'Failed to read object from storage — use downloadUrl.',
      };
    }

    let text: string | null = null;
    let extractionMode: 'utf8' | 'pdf-parse' | 'raw' = 'utf8';

    if (mime === 'application/pdf') {
      try {
        // Lazy require — pdf-parse is optional; if not installed, fall through.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse = require('pdf-parse');
        const parsed = await pdfParse(buffer);
        text = String(parsed?.text ?? '');
        extractionMode = 'pdf-parse';
      } catch (err) {
        this.logger.warn(
          `MCP get_document_content: pdf-parse unavailable or failed for ${document.id}: ${(err as Error).message}`,
        );
        return {
          documentId: document.id,
          fileName: document.fileName,
          mimeType: document.mimeType,
          fileSize: document.fileSize,
          supported: false,
          downloadUrl,
          note: 'PDF text extraction unavailable — raw bytes available, use downloadUrl.',
        };
      }
    } else if (mime.startsWith('text/') || mime === 'application/json') {
      text = buffer.toString('utf8');
      extractionMode = 'utf8';
    } else {
      // Office formats — emit raw bytes as utf8 best-effort. The LLM gets
      // *something* but we mark it raw so it knows the rendering may be poor.
      text = buffer.toString('utf8');
      extractionMode = 'raw';
    }

    const truncated = text.length > TEXT_CAP;
    const content = truncated ? text.slice(0, TEXT_CAP) : text;

    this.logger.log(
      `MCP get_document_content: user=${user.email} doc=${document.id} mode=${extractionMode} truncated=${truncated}`,
    );

    return {
      documentId: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      supported: true,
      extractionMode,
      truncated,
      contentLength: content.length,
      content,
      downloadUrl,
    };
  }

  /**
   * Ingest a new document directly via MCP. Decodes the payload (base64 for
   * binary mime types, plain text for text/*), uploads to MinIO via the
   * shared MinioService, and creates a Document row owned by the calling
   * user. Skips the staged presigned-URL flow — this is for agents that
   * already have the bytes in memory.
   *
   * Caps: 25 MB after decoding. Mime type required and must be a recognised
   * top-level type.
   */
  async uploadDocument(
    user: User,
    args: {
      projectId?: string;
      projectNumber?: string;
      fileName: string;
      content: string;
      mimeType: string;
      description?: string;
    },
  ) {
    this.assertCanWrite(user);

    if (!args.projectId && !args.projectNumber) {
      throw new Error("Either 'projectId' or 'projectNumber' is required.");
    }
    if (!args.fileName || !args.fileName.trim()) {
      throw new Error("'fileName' is required.");
    }
    if (typeof args.content !== 'string') {
      throw new Error("'content' must be a string (base64 for binary, plain for text).");
    }
    if (!args.mimeType || !args.mimeType.trim() || !args.mimeType.includes('/')) {
      throw new Error("'mimeType' is required and must look like 'type/subtype'.");
    }

    // Access check (read) inside the workspace tx, before we touch bytes.
    const project = await this.runScoped(user, (tx) =>
      tx.project.findFirst({
        where: {
          ...buildVisibilityFilter(user),
          ...(args.projectId ? { id: args.projectId } : { projectNumber: args.projectNumber! }),
        },
        select: { id: true, projectNumber: true },
      }),
    );
    if (!project) {
      throw new Error('Project not found or no access');
    }

    const mime = args.mimeType.toLowerCase();
    const isText = mime.startsWith('text/') || mime === 'application/json';

    let buffer: Buffer;
    try {
      buffer = isText ? Buffer.from(args.content, 'utf8') : Buffer.from(args.content, 'base64');
    } catch (err) {
      throw new Error(`Failed to decode content: ${(err as Error).message}`);
    }

    const MAX_BYTES = 25 * 1024 * 1024;
    if (buffer.length === 0) {
      throw new Error('Decoded content is empty.');
    }
    if (buffer.length > MAX_BYTES) {
      throw new Error(`Content exceeds 25MB cap (got ${buffer.length} bytes).`);
    }

    const fileExtension = args.fileName.includes('.')
      ? args.fileName.split('.').pop() || 'bin'
      : 'bin';
    const s3Key = `projects/${project.id}/${uuidv4()}.${fileExtension}`;

    // MinIO byte upload runs OUTSIDE the workspace tx (B4 — no DB transaction
    // held open across object-storage I/O); the metadata write below runs back
    // inside the workspace tx and stamps the active workspaceId.
    await this.minio.uploadObject(s3Key, buffer, buffer.length, {
      'Content-Type': args.mimeType,
    });

    // Schema's DocumentStatus enum has no COMPLETED — UPLOADED is the
    // post-upload terminal state used by the existing proxy upload path.
    const document = await this.runScoped(user, (tx, workspaceId) =>
      tx.document.create({
        data: {
          workspaceId,
          projectId: project.id,
          uploadedById: user.id,
          fileName: args.fileName,
          fileSize: buffer.length,
          mimeType: args.mimeType,
          s3Key,
          s3Bucket: this.minio.getBucketName(),
          status: 'UPLOADED',
          description: args.description,
        },
        select: {
          id: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          status: true,
          description: true,
          uploadedAt: true,
        },
      }),
    );

    this.logger.log(
      `MCP upload_document: user=${user.email} project=${project.projectNumber} doc=${document.id} size=${buffer.length}`,
    );

    return {
      project: { id: project.id, projectNumber: project.projectNumber },
      document,
    };
  }

  /**
   * Patch document metadata (description, tags, display fileName). Mirrors
   * REST PATCH /documents/:id for the safe metadata surface — not storage
   * fields (s3Key / fileSize / mimeType / projectId / status), which agents
   * must not rewrite. Visibility is the same chokepoint as get_document_content
   * (project buildVisibilityFilter; orphan docs admin/manager only). CLIENT
   * users are read-only (assertCanWrite).
   */
  async updateDocument(
    user: User,
    args: {
      documentId: string;
      description?: string | null;
      tags?: string[];
      fileName?: string;
    },
  ) {
    this.assertCanWrite(user);

    if (!args.documentId || !String(args.documentId).trim()) {
      throw new Error("'documentId' is required.");
    }
    const documentId = String(args.documentId).trim();

    const data: Prisma.DocumentUpdateInput = {};
    if (args.description !== undefined) {
      // null / empty string both clear the description (matches Partial REST patch).
      const d = args.description;
      data.description =
        d === null || (typeof d === 'string' && d.trim() === '') ? null : String(d);
    }
    if (args.tags !== undefined) {
      if (!Array.isArray(args.tags) || args.tags.some((t) => typeof t !== 'string')) {
        throw new Error("'tags' must be an array of strings.");
      }
      data.tags = args.tags.map((t) => String(t));
    }
    if (args.fileName !== undefined) {
      const name = String(args.fileName ?? '').trim();
      if (!name) {
        throw new Error("'fileName' must be a non-empty string when provided.");
      }
      if (name.length > 500) {
        throw new Error("'fileName' must be at most 500 characters.");
      }
      data.fileName = name;
    }

    if (Object.keys(data).length === 0) {
      throw new Error(
        "Provide at least one of 'description', 'tags', or 'fileName' to update.",
      );
    }

    const updated = await this.runScoped(user, async (tx) => {
      const existing = await tx.document.findFirst({
        where: {
          id: documentId,
          OR: [
            { project: buildVisibilityFilter(user) },
            ...(user.role === UserRole.ADMIN || user.role === UserRole.MANAGER
              ? [{ projectId: null }]
              : []),
          ],
        },
        select: { id: true },
      });
      if (!existing) {
        throw new Error("Document not found or you don't have access");
      }

      return tx.document.update({
        where: { id: existing.id },
        data,
        select: {
          id: true,
          projectId: true,
          fileName: true,
          fileSize: true,
          mimeType: true,
          status: true,
          description: true,
          tags: true,
          uploadedAt: true,
          updatedAt: true,
        },
      });
    });

    this.logger.log(
      `MCP update_document: user=${user.email} doc=${updated.id} fields=${Object.keys(data).join(',')}`,
    );
    return { document: updated };
  }

  /**
   * Delete a document the caller can see. Mirrors REST DELETE /documents/:id:
   * MinIO object removal runs OUTSIDE the workspace tx (B4 — no DB transaction
   * held open across object-storage I/O); the row delete runs inside a second
   * scoped tx. Visibility matches get_document_content. CLIENT users cannot.
   * MinIO failures are logged and do not block the DB delete (same as REST).
   */
  async deleteDocument(user: User, args: { documentId: string }) {
    this.assertCanWrite(user);

    if (!args.documentId || !String(args.documentId).trim()) {
      throw new Error("'documentId' is required.");
    }
    const documentId = String(args.documentId).trim();

    // Fetch metadata inside the workspace tx (RLS + project visibility).
    const document = await this.runScoped(user, (tx) =>
      tx.document.findFirst({
        where: {
          id: documentId,
          OR: [
            { project: buildVisibilityFilter(user) },
            ...(user.role === UserRole.ADMIN || user.role === UserRole.MANAGER
              ? [{ projectId: null }]
              : []),
          ],
        },
        select: {
          id: true,
          fileName: true,
          s3Key: true,
          status: true,
          fileSize: true,
          projectId: true,
        },
      }),
    );

    if (!document) {
      throw new Error("Document not found or you don't have access");
    }

    // MinIO delete OUTSIDE the tx — only when the object was actually uploaded.
    if (document.status === 'UPLOADED' && document.fileSize > 0 && document.s3Key) {
      try {
        await this.minio.deleteObject(document.s3Key);
      } catch (err) {
        this.logger.warn(
          `MCP delete_document: MinIO delete failed for ${document.id} (${document.s3Key}): ${(err as Error).message}`,
        );
      }
    }

    await this.runScoped(user, (tx) =>
      tx.document.delete({ where: { id: document.id } }),
    );

    this.logger.log(
      `MCP delete_document: user=${user.email} doc=${document.id} file=${document.fileName}`,
    );
    return {
      deleted: true,
      documentId: document.id,
      fileName: document.fileName,
      projectId: document.projectId,
    };
  }

  async updateBillingFields(
    user: User,
    args: {
      id?: string;
      projectNumber?: string;
      invoiceNumber?: string;
      billingAmount?: number;
      amountPaid?: number;
      paymentStatus?: string;
      billingDate?: string;
      paymentDueDate?: string;
      paymentReceivedDate?: string;
      billingNotes?: string;
    },
  ) {
    this.assertCanWrite(user);
    if (!args.id && !args.projectNumber) {
      throw new Error('Either id or projectNumber must be provided');
    }
    // Only patch fields the caller actually passed — undefined skips the
    // column so an empty PATCH doesn't blank out fields by accident.
    const data: Prisma.ProjectUpdateInput = {};
    if (args.invoiceNumber !== undefined) data.invoiceNumber = args.invoiceNumber;
    if (args.billingAmount !== undefined) data.billingAmount = args.billingAmount as any;
    if (args.amountPaid !== undefined) data.amountPaid = args.amountPaid as any;
    if (args.paymentStatus !== undefined) data.paymentStatus = args.paymentStatus as any;
    if (args.billingDate !== undefined)
      data.billingDate = args.billingDate ? new Date(args.billingDate) : null;
    if (args.paymentDueDate !== undefined)
      data.paymentDueDate = args.paymentDueDate ? new Date(args.paymentDueDate) : null;
    if (args.paymentReceivedDate !== undefined)
      data.paymentReceivedDate = args.paymentReceivedDate
        ? new Date(args.paymentReceivedDate)
        : null;
    if (args.billingNotes !== undefined) data.billingNotes = args.billingNotes;

    const updated = await this.runScoped(user, async (tx) => {
      const found = await tx.project.findFirst({
        where: {
          ...buildVisibilityFilter(user),
          ...(args.id ? { id: args.id } : { projectNumber: args.projectNumber! }),
        },
        select: { id: true, projectNumber: true },
      });
      if (!found) {
        throw new Error('Project not found or no access');
      }
      return tx.project.update({
        where: { id: found.id },
        data,
        select: {
          id: true,
          projectNumber: true,
          invoiceNumber: true,
          billingAmount: true,
          amountPaid: true,
          paymentStatus: true,
          billingDate: true,
          paymentDueDate: true,
          paymentReceivedDate: true,
          billingNotes: true,
        },
      });
    });
    this.logger.log(
      `MCP update_billing_fields: user=${user.email} project=${updated.projectNumber}`,
    );
    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Wave 2 tools — reporting / capacity / automations / custom-fields /
  // approvals. Each delegates to the SAME service the REST controller uses,
  // so RBAC + workspace RLS + validation are shared (one code path). Like the
  // time-tracking tools, the active workspace is resolved through the SAME
  // membership-aware chokepoint (claim → default membership) and handed to the
  // service, whose `runForUser` re-authorizes membership against it. Role gates
  // mirror the controllers' @Roles exactly.
  // ─────────────────────────────────────────────────────────────────────

  /** Wave 2 services are always wired by McpService; fail loudly if not. */
  private requireWave2(): Wave2Deps {
    if (!this.wave2) {
      throw new Error('Wave 2 services are not enabled on this server');
    }
    return this.wave2;
  }

  /**
   * Resolve the caller's active workspace via the membership-aware chokepoint
   * (token claim → default membership — never the global default), the same id
   * the REST `@CurrentWorkspace` resolves. The delegated service then runs its
   * own `runForUser(user, …, workspaceId)`, which re-authorizes membership and
   * pins the RLS GUC — identical to the time-tracking tools.
   */
  private resolveWorkspace(user: User): Promise<string> {
    return this.requireWorkspace().resolveAuthorized(user);
  }

  /** MANAGER/ADMIN gate — mirrors the controllers' @Roles(ADMIN, MANAGER). */
  private assertManagerOrAdmin(user: User, surface: string) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
      throw new Error(`Only ADMIN or MANAGER roles can ${surface}.`);
    }
  }

  /** ADMIN-only gate — mirrors controllers' @Roles(ADMIN), e.g. DELETE /tasks/:id. */
  private assertAdmin(user: User, surface: string) {
    if (user.role !== UserRole.ADMIN) {
      throw new Error(`Only ADMIN can ${surface}.`);
    }
  }

  /**
   * Validate + fold custom-field VALUES into TASK metadata exactly as
   * TasksService.resolveMetadataWithCustomFields does: no values supplied →
   * metadata untouched; otherwise validate against the workspace TASK
   * definitions ON THE CALLER'S tx (the validator contract requires it) and
   * merge under `metadata.customFields`, preserving other metadata keys.
   */
  private async resolveTaskMetadata(
    tx: WorkspaceTxClient,
    workspaceId: string,
    incomingMetadata: Prisma.JsonValue | null | undefined,
    customFields: Record<string, any> | undefined,
  ): Promise<Prisma.InputJsonValue | undefined> {
    if (customFields === undefined) return undefined;
    const normalized = await this.requireWave2().customFields.validateValues(
      tx,
      workspaceId,
      CustomFieldEntity.TASK,
      customFields,
    );
    const base =
      incomingMetadata && typeof incomingMetadata === 'object' && !Array.isArray(incomingMetadata)
        ? (incomingMetadata as Record<string, any>)
        : {};
    return { ...base, customFields: normalized } as Prisma.InputJsonValue;
  }

  /** PROJECT counterpart of resolveTaskMetadata (entity = PROJECT). */
  private async resolveProjectMetadata(
    tx: WorkspaceTxClient,
    workspaceId: string,
    incomingMetadata: Prisma.JsonValue | null | undefined,
    customFields: Record<string, any> | undefined,
  ): Promise<Prisma.InputJsonValue | undefined> {
    if (customFields === undefined) return undefined;
    const normalized = await this.requireWave2().customFields.validateValues(
      tx,
      workspaceId,
      CustomFieldEntity.PROJECT,
      customFields,
    );
    const base =
      incomingMetadata && typeof incomingMetadata === 'object' && !Array.isArray(incomingMetadata)
        ? (incomingMetadata as Record<string, any>)
        : {};
    return { ...base, customFields: normalized } as Prisma.InputJsonValue;
  }

  // ── Reporting ────────────────────────────────────────────────────────

  /** Portfolio health roll-up + workspace totals. Read-only (any member). */
  async getPortfolioReport(user: User, _args: Record<string, never>) {
    const w2 = this.requireWave2();
    const res = await w2.reporting.getPortfolio(await this.resolveWorkspace(user), user);
    this.logger.log(`MCP get_portfolio_report: user=${user.email}`);
    return res;
  }

  /**
   * Profitability (billable / cost / margin / realization). MANAGER/ADMIN only,
   * mirroring the controller's @Roles — cost + margin are internal. Optional
   * from/to ISO window.
   */
  async getProfitabilityReport(user: User, args: { from?: string; to?: string }) {
    this.assertManagerOrAdmin(user, 'view the profitability report');
    const w2 = this.requireWave2();
    const res = await w2.reporting.getProfitability(await this.resolveWorkspace(user), user, {
      from: args?.from,
      to: args?.to,
    });
    this.logger.log(`MCP get_profitability_report: user=${user.email}`);
    return res;
  }

  /** Throughput (tasks/projects completed by week + status). Read-only. */
  async getThroughputReport(user: User, args: { from?: string; to?: string }) {
    const w2 = this.requireWave2();
    const res = await w2.reporting.getThroughput(await this.resolveWorkspace(user), user, {
      from: args?.from,
      to: args?.to,
    });
    this.logger.log(`MCP get_throughput_report: user=${user.email}`);
    return res;
  }

  // ── Capacity ─────────────────────────────────────────────────────────

  /** Team capacity vs committed load. MANAGER/ADMIN only (planning surface). */
  async getTeamCapacity(user: User, args: { from?: string; to?: string }) {
    this.assertManagerOrAdmin(user, 'view team capacity');
    const w2 = this.requireWave2();
    const res = await w2.capacity.getTeamCapacity(
      await this.resolveWorkspace(user),
      user,
      args?.from,
      args?.to,
    );
    this.logger.log(`MCP get_team_capacity: user=${user.email}`);
    return res;
  }

  /** The caller's OWN capacity (any active member). 403s a non-member. */
  async getMyCapacity(user: User, args: { from?: string; to?: string }) {
    const w2 = this.requireWave2();
    const res = await w2.capacity.getMyCapacity(
      await this.resolveWorkspace(user),
      user,
      args?.from,
      args?.to,
    );
    this.logger.log(`MCP get_my_capacity: user=${user.email}`);
    return res;
  }

  // ── Automations ──────────────────────────────────────────────────────
  // The REST controller gates EVERY route ADMIN/MANAGER, so list is gated too.

  /** List automation rules. ADMIN/MANAGER. Optional trigger/enabled filter. */
  async listAutomations(user: User, args: { trigger?: string; enabled?: boolean }) {
    this.assertManagerOrAdmin(user, 'view automations');
    const w2 = this.requireWave2();
    const trigger = this.parseAutomationTrigger(args?.trigger);
    const res = await w2.automations.findAll(await this.resolveWorkspace(user), user, {
      trigger,
      enabled: typeof args?.enabled === 'boolean' ? args.enabled : undefined,
    });
    this.logger.log(`MCP list_automations: user=${user.email} count=${res.length}`);
    return { automations: res, count: res.length };
  }

  /** Create an automation rule. ADMIN/MANAGER. */
  async createAutomation(
    user: User,
    args: {
      name: string;
      trigger: string;
      conditions?: unknown[];
      actions: unknown[];
      enabled?: boolean;
    },
  ) {
    this.assertManagerOrAdmin(user, 'create automations');
    const trigger = this.parseAutomationTrigger(args?.trigger);
    if (!trigger) {
      throw new Error(
        `Invalid trigger. Must be one of: ${Object.values(AutomationTrigger).join(', ')}.`,
      );
    }
    if (!Array.isArray(args?.actions) || args.actions.length === 0) {
      throw new Error('actions is required and must be a non-empty array of { type, params }.');
    }
    const w2 = this.requireWave2();
    // The service persists conditions/actions as JSON; the REST DTO validates
    // their shape, so we pass the same {name, trigger, enabled, conditions,
    // actions} shape through.
    const res = await w2.automations.create(await this.resolveWorkspace(user), user, {
      name: args.name,
      trigger,
      enabled: args.enabled,
      conditions: args.conditions ?? [],
      actions: args.actions,
    } as any);
    this.logger.log(`MCP create_automation: user=${user.email} rule=${res.id}`);
    return res;
  }

  /** Enable/disable an automation rule. ADMIN/MANAGER. */
  async setAutomationEnabled(user: User, args: { id: string; enabled: boolean }) {
    this.assertManagerOrAdmin(user, 'update automations');
    if (!args?.id) throw new Error("'id' is required.");
    if (typeof args?.enabled !== 'boolean') throw new Error("'enabled' (boolean) is required.");
    const w2 = this.requireWave2();
    const res = await w2.automations.update(await this.resolveWorkspace(user), user, args.id, {
      enabled: args.enabled,
    } as any);
    this.logger.log(
      `MCP set_automation_enabled: user=${user.email} rule=${args.id} → ${args.enabled}`,
    );
    return res;
  }

  /** Delete an automation rule. ADMIN/MANAGER. */
  async deleteAutomation(user: User, args: { id: string }) {
    this.assertManagerOrAdmin(user, 'delete automations');
    if (!args?.id) throw new Error("'id' is required.");
    const w2 = this.requireWave2();
    const res = await w2.automations.remove(await this.resolveWorkspace(user), user, args.id);
    this.logger.log(`MCP delete_automation: user=${user.email} rule=${args.id}`);
    return res;
  }

  /** Coerce a trigger string to the AutomationTrigger enum (or undefined). */
  private parseAutomationTrigger(raw: string | undefined): AutomationTrigger | undefined {
    if (!raw) return undefined;
    return (AutomationTrigger as Record<string, AutomationTrigger>)[raw] ?? undefined;
  }

  // ── Custom fields ────────────────────────────────────────────────────

  /** List custom-field DEFINITIONS for an entity (TASK|PROJECT). Any member. */
  async listCustomFields(user: User, args: { entity: string }) {
    const entity = (CustomFieldEntity as Record<string, CustomFieldEntity>)[args?.entity ?? ''];
    if (!entity) {
      throw new Error(
        `Invalid entity. Must be one of: ${Object.values(CustomFieldEntity).join(', ')}.`,
      );
    }
    const w2 = this.requireWave2();
    const res = await w2.customFields.findAllForEntity(
      await this.resolveWorkspace(user),
      user,
      entity,
    );
    this.logger.log(
      `MCP list_custom_fields: user=${user.email} entity=${entity} count=${res.length}`,
    );
    return { entity, customFields: res, count: res.length };
  }

  // ── Approvals (staff side of the client-portal loop) ─────────────────
  // Both are STAFF surfaces (@Roles ADMIN/MANAGER/STAFF) — i.e. not clients;
  // assertCanWrite is exactly that gate (CLIENT-only rejection).

  /** List ALL approvals on a project (the requester/staff view). Staff only. */
  async listProjectApprovals(user: User, args: { projectId: string }) {
    this.assertCanWrite(user);
    if (!args?.projectId) throw new Error("'projectId' is required.");
    const w2 = this.requireWave2();
    const res = await w2.approvals.listForProject(
      await this.resolveWorkspace(user),
      user,
      args.projectId,
    );
    this.logger.log(`MCP list_project_approvals: user=${user.email} project=${args.projectId}`);
    return res;
  }

  /**
   * Request a client approval on a document / deliverable / project. Staff only
   * (CLIENT cannot). Mirrors the staff-guarded POST /client-portal/approvals.
   */
  async requestApproval(
    user: User,
    args: {
      entityType: string;
      entityId: string;
      projectId?: string;
      approverContactId?: string;
      note?: string;
    },
  ) {
    this.assertCanWrite(user);
    const entityType = (ApprovalEntityType as Record<string, ApprovalEntityType>)[
      args?.entityType ?? ''
    ];
    if (!entityType) {
      throw new Error(
        `Invalid entityType. Must be one of: ${Object.values(ApprovalEntityType).join(', ')}.`,
      );
    }
    if (!args?.entityId) throw new Error("'entityId' is required.");
    const w2 = this.requireWave2();
    const res = await w2.approvals.request(await this.resolveWorkspace(user), user, {
      entityType,
      entityId: args.entityId,
      projectId: args.projectId,
      approverContactId: args.approverContactId,
      note: args.note,
    } as any);
    this.logger.log(`MCP request_approval: user=${user.email} approval=${res.id}`);
    return res;
  }

  // ── Custom-field definitions: create ─────────────────────────────────

  /**
   * Create a custom-field DEFINITION for an entity (TASK|PROJECT). Mirrors the
   * REST POST, which is workspace-membership-gated with NO @Roles — so any
   * non-CLIENT member. CustomFieldsService.create owns validation (key
   * slugify, SELECT/MULTISELECT options requirement), the (workspaceId, entity,
   * key) uniqueness conflict, RLS, and audit.
   */
  async createCustomField(
    user: User,
    args: {
      entity: string;
      label: string;
      type: string;
      key?: string;
      options?: string[];
      required?: boolean;
      position?: number;
    },
  ) {
    this.assertCanWrite(user);
    const entity = (CustomFieldEntity as Record<string, CustomFieldEntity>)[args?.entity ?? ''];
    if (!entity) {
      throw new Error(
        `Invalid entity. Must be one of: ${Object.values(CustomFieldEntity).join(', ')}.`,
      );
    }
    const type = (CustomFieldType as Record<string, CustomFieldType>)[args?.type ?? ''];
    if (!type) {
      throw new Error(`Invalid type. Must be one of: ${Object.values(CustomFieldType).join(', ')}.`);
    }
    if (!args?.label || !args.label.trim()) {
      throw new Error("'label' is required.");
    }
    const w2 = this.requireWave2();
    const res = await w2.customFields.create(await this.resolveWorkspace(user), user, {
      entity,
      label: args.label,
      type,
      key: args.key,
      options: args.options,
      required: args.required,
      position: args.position,
    } as any);
    this.logger.log(`MCP create_custom_field: user=${user.email} entity=${entity} type=${type}`);
    return res;
  }

  // ── Billing: issue invoice ───────────────────────────────────────────

  /**
   * Issue + send an invoice in one step: roll up APPROVED, billable, unbilled
   * time and ask Accounting-Ops to ISSUE it (status=sent). Thin wrapper over
   * createBillableDraft with autoSend=true, so it inherits that path's
   * MANAGER/ADMIN gate. When Accounting-Ops isn't connected/entitled (or no
   * user bearer is present) it CANNOT actually send — the rollup returns a
   * draft + PDF preview and the response `status` says which happened. There is
   * deliberately no "send an existing draft" path (PO has no backing for it).
   */
  async issueInvoice(
    user: User,
    args: {
      projectId?: string;
      clientId?: string;
      periodStart?: string;
      periodEnd?: string;
      groupBy?: string;
    },
  ) {
    return this.createBillableDraft(user, { ...args, autoSend: true });
  }

  // ── Project lifecycle: archive (the safe alternative to deletion) ────

  /**
   * Archive (retire) a project by setting status=ARCHIVED — the safe,
   * reversible alternative to deletion. Project-Ops intentionally does NOT
   * expose permanent project deletion through the agent surface (a hard delete
   * is irreversible and cascades); archived projects drop out of active views
   * but are preserved. Reuses updateProjectStatus, so it shares the exact
   * visibility check + assertCanWrite gate. Un-archive via update_project_status.
   */
  async archiveProject(user: User, args: { id?: string; projectNumber?: string }) {
    return this.updateProjectStatus(user, { ...args, status: 'ARCHIVED' });
  }

  // ── Workspace member management ──────────────────────────────────────
  // Delegate to WorkspacesService, which owns the control-plane `memberships`
  // table (deliberately NON-RLS) and re-resolves the CALLER'S WorkspaceRole in
  // the target workspace for every op (OWNER/ADMIN gates + last-owner
  // protection live there, not here). The target is always the caller's ACTIVE
  // workspace — resolved through the same membership-aware chokepoint as every
  // other tool. NOTE: roles here are WORKSPACE roles
  // (VIEWER/MEMBER/MANAGER/ADMIN/OWNER), distinct from the app-level User.role.

  /** WorkspacesService is wired by McpService; fail loudly if a caller forgot it. */
  private requireWorkspaceAdmin(): WorkspacesService {
    if (!this.workspaceAdmin) {
      throw new Error('Workspace administration is not enabled on this server');
    }
    return this.workspaceAdmin;
  }

  /**
   * List the members of the caller's active workspace, including pending
   * invites. Any active member (WorkspacesService.listMembers requires
   * membership). Each row carries the `userKey` to pass to update_member_role /
   * remove_member.
   */
  async listMembers(user: User, _args: Record<string, never>) {
    const wa = this.requireWorkspaceAdmin();
    const res = await wa.listMembers(user, await this.resolveWorkspace(user));
    this.logger.log(`MCP list_members: user=${user.email}`);
    return res;
  }

  /**
   * Invite / add a member to the caller's active workspace by email. Existing
   * users are added ACTIVE immediately; unknown emails get an invite LINK
   * returned (no email is sent — the caller delivers it). OWNER/ADMIN only and
   * OWNER cannot be granted here (both enforced by WorkspacesService.addMember).
   * role defaults to MEMBER.
   */
  async inviteMember(user: User, args: { email: string; role?: string }) {
    if (!args?.email || !args.email.trim()) {
      throw new Error("'email' is required.");
    }
    const role = args?.role ? (WorkspaceRole as Record<string, WorkspaceRole>)[args.role] : undefined;
    if (args?.role && !role) {
      throw new Error(`Invalid role. Must be one of: ${Object.values(WorkspaceRole).join(', ')}.`);
    }
    const wa = this.requireWorkspaceAdmin();
    const res = await wa.addMember(user, await this.resolveWorkspace(user), {
      email: args.email,
      role,
    } as any);
    this.logger.log(`MCP invite_member: user=${user.email} invitee=${args.email}`);
    return res;
  }

  /**
   * Change a member's WORKSPACE role. OWNER only; refuses to demote the last
   * active OWNER (both enforced by WorkspacesService.updateMemberRole).
   * `userKey` identifies the target (from list_members).
   */
  async updateMemberRole(user: User, args: { userKey: string; role: string }) {
    if (!args?.userKey) throw new Error("'userKey' is required (get it from list_members).");
    const role = (WorkspaceRole as Record<string, WorkspaceRole>)[args?.role ?? ''];
    if (!role) {
      throw new Error(`Invalid role. Must be one of: ${Object.values(WorkspaceRole).join(', ')}.`);
    }
    const wa = this.requireWorkspaceAdmin();
    const res = await wa.updateMemberRole(
      user,
      await this.resolveWorkspace(user),
      args.userKey,
      role,
    );
    this.logger.log(`MCP update_member_role: user=${user.email} target=${args.userKey} → ${role}`);
    return res;
  }

  /**
   * Remove a member from the caller's active workspace. OWNER only; refuses to
   * remove the last active OWNER (both enforced by WorkspacesService.removeMember).
   * `userKey` identifies the target (from list_members).
   */
  async removeMember(user: User, args: { userKey: string }) {
    if (!args?.userKey) throw new Error("'userKey' is required (get it from list_members).");
    const wa = this.requireWorkspaceAdmin();
    const res = await wa.removeMember(user, await this.resolveWorkspace(user), args.userKey);
    this.logger.log(`MCP remove_member: user=${user.email} target=${args.userKey}`);
    return res;
  }
}
