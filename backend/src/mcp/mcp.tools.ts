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
import { MinioService } from '../documents/minio.service';
import { v4 as uuidv4 } from 'uuid';

// Type-only imports: the time-tracking services import buildVisibilityFilter
// FROM this file, so importing their *values* here would create a runtime
// cycle. `import type` is erased at compile time, so it's safe.
import type { TimerService } from '../time-tracking/timer.service';
import type { TimeEntryService } from '../time-tracking/time-entry.service';
import type { TimesheetService } from '../time-tracking/timesheet.service';
import type { ReportsService } from '../time-tracking/reports.service';
import type { BillableRollupService } from '../time-tracking/billing/billable-rollup.service';
import type { WorkspaceContextService } from '../common/workspace/workspace-context.service';

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

export class ProjectOpsTools {
  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly logger: Logger = console,
    private readonly tt?: TimeTrackingDeps,
    private readonly bearerToken: string | null = null,
  ) {}

  // ── Time tracking tools ──────────────────────────────────
  // Delegate to the time-tracking services so MCP and REST share one code
  // path. Services enforce RBAC, workspace scoping, lock/bill immutability,
  // and rate/rounding rules; they throw on violation (surfaced as tool errors).

  private requireTt(): TimeTrackingDeps {
    if (!this.tt) throw new Error('Time tracking is not enabled on this server');
    return this.tt;
  }

  private workspaceFor(user: User): string {
    return this.requireTt().workspace.resolve(user);
  }

  async startTimer(user: User, args: { projectId?: string; taskId?: string; description?: string }) {
    const tt = this.requireTt();
    const res = await tt.timer.startTimer(this.workspaceFor(user), user, args);
    this.logger.log(`MCP start_timer: user=${user.email}`);
    return res;
  }

  async stopTimer(user: User, _args: Record<string, never>) {
    const tt = this.requireTt();
    const res = await tt.timer.stopTimer(this.workspaceFor(user), user);
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
    const res = await tt.timeEntry.logTime(this.workspaceFor(user), user, args as any);
    this.logger.log(`MCP log_time: user=${user.email}`);
    return res;
  }

  async updateTimeEntry(user: User, args: { id: string } & Record<string, any>) {
    const { id, ...rest } = args;
    if (!id) throw new Error('id is required');
    const tt = this.requireTt();
    return tt.timeEntry.update(this.workspaceFor(user), user, id, rest as any);
  }

  async listTimeEntries(user: User, args: Record<string, any>) {
    const tt = this.requireTt();
    return tt.timeEntry.list(this.workspaceFor(user), user, (args ?? {}) as any);
  }

  async submitTimesheet(user: User, args: { periodStart?: string }) {
    const tt = this.requireTt();
    const res = await tt.timesheet.submit(this.workspaceFor(user), user, args ?? {});
    this.logger.log(`MCP submit_timesheet: user=${user.email}`);
    return res;
  }

  async approveTime(user: User, args: { timesheetPeriodId?: string; timeEntryIds?: string[] }) {
    const tt = this.requireTt();
    const res = await tt.timesheet.approve(this.workspaceFor(user), user, args ?? {});
    this.logger.log(`MCP approve_time: user=${user.email}`);
    return res;
  }

  async getUtilization(user: User, args: { from?: string; to?: string; userId?: string }) {
    const tt = this.requireTt();
    return tt.reports.getUtilization(this.workspaceFor(user), user, args ?? {});
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
    const res = await tt.rollup.createBillableDraft(this.workspaceFor(user), user, args as any, {
      bearerToken: this.bearerToken,
      actingUser: { id: user.id, email: user.email },
    });
    this.logger.log(`MCP create_billable_draft: user=${user.email} status=${(res as any).status}`);
    return res;
  }

  async syncInvoiceStatus(user: User, _args: Record<string, never>) {
    const tt = this.requireTt();
    return tt.rollup.syncInvoiceStatuses(this.bearerToken);
  }

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

  // ─────────────────────────────────────────────────────────────────────
  // Write tools — schema-validated, RBAC enforced
  // Mirrors the existing REST endpoints. Only allow ADMIN / MANAGER /
  // STAFF to create or change state; CLIENT users are read-only.
  // ─────────────────────────────────────────────────────────────────────

  // Exposed for testing — same behaviour as before.
  assertCanWrite(user: User) {
    if (user.role === UserRole.CLIENT) {
      throw new Error("Read-only role — clients cannot create or update.");
    }
  }

  // Org creation mirrors the REST endpoint's @Roles(ADMIN, MANAGER) guard.
  assertCanManageOrgs(user: User) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
      throw new Error("Only ADMIN or MANAGER roles can create organizations.");
    }
  }

  async listOrganizations(
    user: User,
    args: { type?: string; isActive?: boolean; limit?: number },
  ) {
    const where: Prisma.OrganizationWhereInput = {
      ...(args.type ? { type: args.type.toUpperCase() as any } : {}),
      ...(args.isActive !== undefined ? { isActive: args.isActive } : {}),
    };
    // CLIENTs only see orgs they're a contact in (matches REST org tree filter).
    if (user.role === UserRole.CLIENT) {
      const contact = await this.prisma.contact.findFirst({
        where: { userId: user.id },
        select: { organizationId: true },
      });
      if (!contact?.organizationId) return { organizations: [], count: 0 };
      where.id = contact.organizationId;
    }
    const organizations = await this.prisma.organization.findMany({
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
    return { organizations, count: organizations.length };
  }

  async getOrganization(user: User, args: { id: string }) {
    if (!args.id) throw new Error("'id' is required.");
    if (user.role === UserRole.CLIENT) {
      const contact = await this.prisma.contact.findFirst({
        where: { userId: user.id, organizationId: args.id },
        select: { id: true },
      });
      if (!contact) throw new Error("Organization not found or no access.");
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: args.id },
      include: {
        parentOrg: { select: { id: true, name: true, type: true } },
        childOrgs: { select: { id: true, name: true, type: true, isActive: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        _count: { select: { projects: true, contacts: true } },
      },
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

    const existing = await this.prisma.organization.findUnique({
      where: { id: args.id },
      select: { id: true },
    });
    if (!existing) throw new Error(`Organization '${args.id}' not found.`);

    if (args.type) {
      const validTypes = ['AGENCY', 'BUSINESS', 'INDIVIDUAL', 'PARTNER'];
      if (!validTypes.includes(args.type.toUpperCase())) {
        throw new Error(
          `Invalid type '${args.type}'. Must be one of: ${validTypes.join(', ')}.`,
        );
      }
    }

    if (args.parentOrgId) {
      if (args.parentOrgId === args.id) {
        throw new Error('Organization cannot be its own parent.');
      }
      const parent = await this.prisma.organization.findUnique({
        where: { id: args.parentOrgId },
        select: { id: true },
      });
      if (!parent) {
        throw new Error(`Parent organization '${args.parentOrgId}' not found.`);
      }
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

    const updated = await this.prisma.organization.update({
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
    this.logger.log(
      `MCP update_organization: user=${user.email} org=${updated.id}`,
    );
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
      throw new Error(
        `Invalid type '${args.type}'. Must be one of: ${validTypes.join(', ')}.`,
      );
    }

    if (args.parentOrgId) {
      const parent = await this.prisma.organization.findUnique({
        where: { id: args.parentOrgId },
        select: { id: true },
      });
      if (!parent) {
        throw new Error(`Parent organization '${args.parentOrgId}' not found.`);
      }
    }

    const organization = await this.prisma.organization.create({
      data: {
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
    },
  ) {
    this.assertCanWrite(user);
    const last = await this.prisma.project.findFirst({
      where: { projectNumber: { startsWith: 'P-' } },
      orderBy: { projectNumber: 'desc' },
      select: { projectNumber: true },
    });
    const next =
      last?.projectNumber?.match(/^P-(\d+)$/)?.[1] !== undefined
        ? parseInt(last!.projectNumber!.match(/^P-(\d+)$/)![1], 10) + 1
        : 1;
    const projectNumber = `P-${String(next).padStart(5, '0')}`;
    const project = await this.prisma.project.create({
      data: {
        projectNumber,
        title: args.title,
        description: args.description,
        clientName: args.clientName,
        organizationId: args.organizationId,
        priority: (args.priority as any) ?? 'MEDIUM',
        dueDate: args.dueDate ? new Date(args.dueDate) : null,
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
      },
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
    const found = await this.prisma.project.findFirst({
      where: {
        ...buildVisibilityFilter(user),
        ...(args.id ? { id: args.id } : { projectNumber: args.projectNumber! }),
      },
      select: { id: true, projectNumber: true },
    });
    if (!found) {
      throw new Error('Project not found or no access');
    }
    const updated = await this.prisma.project.update({
      where: { id: found.id },
      data: {
        status: args.status as any,
        ...(args.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
      select: { id: true, projectNumber: true, status: true, completedAt: true },
    });
    this.logger.log(`MCP update_project_status: user=${user.email} project=${updated.projectNumber} → ${updated.status}`);
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
    },
  ) {
    this.assertCanWrite(user);
    if (!args.id && !args.projectNumber) {
      throw new Error('Either id or projectNumber must be provided');
    }
    const found = await this.prisma.project.findFirst({
      where: {
        ...buildVisibilityFilter(user),
        ...(args.id ? { id: args.id } : { projectNumber: args.projectNumber! }),
      },
      select: { id: true, projectNumber: true },
    });
    if (!found) {
      throw new Error('Project not found or no access');
    }

    if (args.organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: args.organizationId },
        select: { id: true },
      });
      if (!org) {
        throw new Error(`Organization '${args.organizationId}' not found.`);
      }
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

    const updated = await this.prisma.project.update({
      where: { id: found.id },
      data,
      select: {
        id: true,
        projectNumber: true,
        title: true,
        clientName: true,
        priority: true,
        dueDate: true,
        organization: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.logger.log(
      `MCP update_project: user=${user.email} project=${updated.projectNumber}`,
    );
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
    },
  ) {
    this.assertCanWrite(user);
    const found = await this.prisma.task.findFirst({
      where: {
        id: args.taskId,
        project: buildVisibilityFilter(user),
      },
      select: { id: true, projectId: true },
    });
    if (!found) {
      throw new Error('Task not found or no access');
    }

    let targetProjectId: string | undefined;
    if (args.projectId || args.projectNumber) {
      const target = await this.prisma.project.findFirst({
        where: {
          ...buildVisibilityFilter(user),
          ...(args.projectId
            ? { id: args.projectId }
            : { projectNumber: args.projectNumber! }),
        },
        select: { id: true },
      });
      if (!target) {
        throw new Error('Target project not found or no access');
      }
      targetProjectId = target.id;
    }

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
    if (targetProjectId !== undefined) {
      data.project = { connect: { id: targetProjectId } };
    }

    const updated = await this.prisma.task.update({
      where: { id: found.id },
      data,
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        project: { select: { id: true, projectNumber: true, title: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
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
    },
  ) {
    this.assertCanWrite(user);
    if (!args.projectId && !args.projectNumber) {
      throw new Error('Either projectId or projectNumber must be provided');
    }
    const project = await this.prisma.project.findFirst({
      where: {
        ...buildVisibilityFilter(user),
        ...(args.projectId
          ? { id: args.projectId }
          : { projectNumber: args.projectNumber! }),
      },
      select: { id: true, projectNumber: true },
    });
    if (!project) {
      throw new Error('Project not found or no access');
    }
    const task = await this.prisma.task.create({
      data: {
        projectId: project.id,
        title: args.title,
        description: args.description,
        type: (args.type as any) ?? 'OTHER',
        priority: (args.priority as any) ?? 'MEDIUM',
        dueDate: args.dueDate ? new Date(args.dueDate) : null,
        createdById: user.id,
        assignedToId: args.assignedToId ?? user.id,
      },
      select: {
        id: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        project: { select: { projectNumber: true, title: true } },
      },
    });
    this.logger.log(`MCP create_task: user=${user.email} project=${project.projectNumber} task=${task.id}`);
    return task;
  }

  async updateTaskStatus(
    user: User,
    args: { taskId: string; status: string },
  ) {
    this.assertCanWrite(user);
    const found = await this.prisma.task.findFirst({
      where: {
        id: args.taskId,
        project: buildVisibilityFilter(user),
      },
      select: { id: true },
    });
    if (!found) {
      throw new Error('Task not found or no access');
    }
    const updated = await this.prisma.task.update({
      where: { id: found.id },
      data: {
        status: args.status as any,
        ...(args.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
      select: { id: true, title: true, status: true, completedAt: true },
    });
    this.logger.log(`MCP update_task_status: user=${user.email} task=${updated.id} → ${updated.status}`);
    return updated;
  }

  async listProjectDocuments(user: User, args: { projectId?: string; projectNumber?: string }) {
    if (!args.projectId && !args.projectNumber) {
      throw new Error('Either projectId or projectNumber must be provided');
    }
    const project = await this.prisma.project.findFirst({
      where: {
        ...buildVisibilityFilter(user),
        ...(args.projectId ? { id: args.projectId } : { projectNumber: args.projectNumber! }),
      },
      select: { id: true, projectNumber: true },
    });
    if (!project) {
      throw new Error('Project not found or no access');
    }
    const documents = await this.prisma.document.findMany({
      where: { projectId: project.id },
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
      throw new Error(
        "Provide 'documentId', or both 'fileName' and 'projectNumber'.",
      );
    }

    let document;
    if (args.documentId) {
      document = await this.prisma.document.findFirst({
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
    } else {
      document = await this.prisma.document.findFirst({
        where: {
          fileName: args.fileName!,
          project: {
            ...buildVisibilityFilter(user),
            projectNumber: args.projectNumber!,
          },
        },
        orderBy: { uploadedAt: 'desc' },
      });
    }

    if (!document) {
      throw new Error("Document not found or you don't have access");
    }

    const downloadUrl = await this.minio.getPresignedDownloadUrl(
      document.s3Key,
      3600,
    );

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

    const project = await this.prisma.project.findFirst({
      where: {
        ...buildVisibilityFilter(user),
        ...(args.projectId
          ? { id: args.projectId }
          : { projectNumber: args.projectNumber! }),
      },
      select: { id: true, projectNumber: true },
    });
    if (!project) {
      throw new Error('Project not found or no access');
    }

    const mime = args.mimeType.toLowerCase();
    const isText = mime.startsWith('text/') || mime === 'application/json';

    let buffer: Buffer;
    try {
      buffer = isText
        ? Buffer.from(args.content, 'utf8')
        : Buffer.from(args.content, 'base64');
    } catch (err) {
      throw new Error(`Failed to decode content: ${(err as Error).message}`);
    }

    const MAX_BYTES = 25 * 1024 * 1024;
    if (buffer.length === 0) {
      throw new Error('Decoded content is empty.');
    }
    if (buffer.length > MAX_BYTES) {
      throw new Error(
        `Content exceeds 25MB cap (got ${buffer.length} bytes).`,
      );
    }

    const fileExtension =
      args.fileName.includes('.') ? args.fileName.split('.').pop() || 'bin' : 'bin';
    const s3Key = `projects/${project.id}/${uuidv4()}.${fileExtension}`;

    await this.minio.uploadObject(s3Key, buffer, buffer.length, {
      'Content-Type': args.mimeType,
    });

    // Schema's DocumentStatus enum has no COMPLETED — UPLOADED is the
    // post-upload terminal state used by the existing proxy upload path.
    const document = await this.prisma.document.create({
      data: {
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
    });

    this.logger.log(
      `MCP upload_document: user=${user.email} project=${project.projectNumber} doc=${document.id} size=${buffer.length}`,
    );

    return {
      project: { id: project.id, projectNumber: project.projectNumber },
      document,
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
    const found = await this.prisma.project.findFirst({
      where: {
        ...buildVisibilityFilter(user),
        ...(args.id ? { id: args.id } : { projectNumber: args.projectNumber! }),
      },
      select: { id: true, projectNumber: true },
    });
    if (!found) {
      throw new Error('Project not found or no access');
    }
    // Only patch fields the caller actually passed — undefined skips the
    // column so an empty PATCH doesn't blank out fields by accident.
    const data: Prisma.ProjectUpdateInput = {};
    if (args.invoiceNumber !== undefined) data.invoiceNumber = args.invoiceNumber;
    if (args.billingAmount !== undefined) data.billingAmount = args.billingAmount as any;
    if (args.amountPaid !== undefined) data.amountPaid = args.amountPaid as any;
    if (args.paymentStatus !== undefined) data.paymentStatus = args.paymentStatus as any;
    if (args.billingDate !== undefined) data.billingDate = args.billingDate ? new Date(args.billingDate) : null;
    if (args.paymentDueDate !== undefined) data.paymentDueDate = args.paymentDueDate ? new Date(args.paymentDueDate) : null;
    if (args.paymentReceivedDate !== undefined) data.paymentReceivedDate = args.paymentReceivedDate ? new Date(args.paymentReceivedDate) : null;
    if (args.billingNotes !== undefined) data.billingNotes = args.billingNotes;

    const updated = await this.prisma.project.update({
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
    this.logger.log(`MCP update_billing_fields: user=${user.email} project=${updated.projectNumber}`);
    return updated;
  }
}
