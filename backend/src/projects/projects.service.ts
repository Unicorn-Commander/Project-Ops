import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Optional,
  Inject,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { Project, Prisma, ProjectStatus, TaskStatus, User, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AuditService } from '../audit/audit.service';
import { CUSTOM_FIELDS_SERVICE, CustomFieldsValidator } from './custom-fields.contract';
import { withProjectQuote } from '../common/serializers/client-metadata';
import { coerceDateOnly } from '../common/time/business-time';

/**
 * Domain events emitted (after the tx commits) for the automations + webhooks
 * engines. Kept as string constants so listeners and tests share one source.
 */
export const PROJECT_CREATED_EVENT = 'project.created';
export const PROJECT_STATUS_CHANGED_EVENT = 'project.status_changed';

export interface ProjectCreatedEvent {
  workspaceId: string;
  projectId: string;
  actorId: string;
  project: Project;
}

export interface ProjectStatusChangedEvent {
  workspaceId: string;
  projectId: string;
  fromStatus: ProjectStatus;
  toStatus: ProjectStatus;
  actorId: string;
  project: Project;
}

/** Prisma Decimal | null -> number | null (house pattern, see time-tracking/serialize). */
function decToNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  return parseFloat(v.toString());
}

/** Seconds -> hours, rounded to 2dp (matches ReportsService.hours). */
function secondsToHours(seconds: number | null | undefined): number {
  return Math.round(((seconds || 0) / 3600) * 100) / 100;
}

/**
 * actual / budget as a fraction. Returns null when there is no budget to measure
 * against (null or 0) — 0 would otherwise yield Infinity, which isn't valid JSON.
 */
function pct(actual: number, budget: number | null): number | null {
  if (budget === null || budget === 0) return null;
  return actual / budget;
}

/** Per-project task rollup attached to each item in the GET /projects list. */
export interface TaskStats {
  total: number;
  completed: number;
}

/**
 * Compact per-project budget rollup attached to each item in the GET /projects
 * list so the UI can render an over-budget badge without an extra call per row.
 * `loggedHours` is the sum of ALL time-entry hours; `pctHours` is
 * loggedHours/budgetHours (null when no hours budget is set). Money is excluded
 * here on purpose — the full burn-down (incl. billed amount) is the dedicated
 * GET /projects/:id/budget endpoint.
 */
export interface ProjectBudgetSummary {
  budgetHours: number | null;
  budgetAmount: string | null;
  loggedHours: number;
  pctHours: number | null;
}

/** Full budget burn-down returned by {@link ProjectsService.getBudget}. */
export interface ProjectBudget {
  budgetHours: number | null;
  budgetAmount: string | null;
  loggedHours: number;
  billableHours: number;
  billedAmount: string;
  pctHours: number | null;
  pctAmount: number | null;
  overBudgetHours: boolean;
  overBudgetAmount: boolean;
}

/**
 * Shape of a project as returned by {@link ProjectsService.findAll}: the full
 * Project (incl. scalar `category`/`tags`) plus the `taskStats` rollup and the
 * additive `budgetSummary`. Other relations (contact/createdBy/assignedTo/
 * _count) are also present via the query `include`; this type captures the
 * additive contracts.
 */
export type ProjectWithTaskStats = Project & {
  taskStats: TaskStats;
  budgetSummary: ProjectBudgetSummary;
};

/**
 * SUITE TENANCY (Phase 2, B1): every project read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. All project DB access goes through
 * the passed `tx`, never `this.prisma`, or it bypasses the GUC chokepoint.
 * `workspaceId` is stamped onto every created Project and carried into every
 * `audit.log()` call. Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off
 * (membership resolution is a no-op and withWorkspace runs under the BYPASSRLS
 * owner connection).
 *
 * Both `findOne` and `findByProjectNumber` are workspace-scoped (blueprint R1,
 * approved): a project from another workspace 404s rather than leaking, which
 * is the fail-closed behavior once RLS is live.
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly eventEmitter: EventEmitter2,
    // The custom-fields service is owned by another module and may not be wired
    // in every checkout/deploy. Inject it OPTIONALLY by token: when present we
    // validate + normalize custom-field values through it; when absent we store
    // the incoming map as-is (graceful no-op) rather than failing to boot.
    @Optional()
    @Inject(CUSTOM_FIELDS_SERVICE)
    private readonly customFields?: CustomFieldsValidator,
    @Optional() private readonly membership?: MembershipService,
  ) {}

  /**
   * Validate + normalize a project's `customFields` against the workspace's
   * PROJECT field definitions (inside the active workspace tx so RLS scopes the
   * definition reads), then merge the normalized values into
   * `metadata.customFields`, preserving any other metadata keys. Returns the
   * metadata object to persist, or `undefined`/passthrough when there is nothing
   * to change (so callers can omit it from the Prisma `data`).
   *
   * Mirrors the tasks-side resolveMetadataWithCustomFields exactly (same shared
   * CUSTOM_FIELDS_SERVICE token): throws a BadRequestException when
   * `customFields` is supplied but no CustomFieldsService is wired, so a value
   * can't silently bypass validation.
   */
  private async resolveMetadataWithCustomFields(
    tx: WorkspaceTxClient,
    workspaceId: string,
    incomingMetadata: any,
    customFields: Record<string, any> | undefined,
  ): Promise<any | undefined> {
    if (customFields === undefined) {
      // No custom-field values supplied → pass metadata through untouched.
      return incomingMetadata;
    }

    if (!this.customFields) {
      throw new BadRequestException('Custom fields are not available in this deployment');
    }

    const normalized = await this.customFields.validateValues(
      tx,
      workspaceId,
      'PROJECT',
      customFields,
    );

    const base = incomingMetadata && typeof incomingMetadata === 'object' ? incomingMetadata : {};
    return { ...base, customFields: normalized };
  }

  /**
   * Coerce ISO date *strings* (e.g. "2026-06-01" from an <input type="date">)
   * into Date objects before they reach Prisma. The DTOs validate these with
   * @IsDateString(), which accepts date-only strings, but Prisma's DateTime
   * columns reject a string without a time component and throw a 500. Convert
   * any present date field to a real Date so every write path is safe.
   */
  private coerceDateFields<T extends Record<string, any>>(data: T): T {
    const dateFields = ['dueDate', 'billingDate', 'paymentDueDate', 'paymentReceivedDate'] as const;
    for (const field of dateFields) {
      const value = data[field];
      if (typeof value === 'string' && value.length > 0) {
        (data as Record<string, any>)[field] = coerceDateOnly(value);
      }
    }
    return data;
  }

  /**
   * Create a project for the acting user's active workspace. Opens the
   * workspace RLS transaction and delegates to {@link createInTx}, which runs
   * the project-number count + create together inside that single tx.
   */
  async create(
    workspaceId: string,
    user: User,
    createProjectDto: CreateProjectDto,
  ): Promise<Project> {
    const project = await this.workspaceContext.runForUser(
      user,
      (tx) => this.createInTx(tx, workspaceId, user, createProjectDto),
      workspaceId,
    );

    // Domain event AFTER the tx commits (mirrors tasks.addComment): a listener
    // that re-queries sees a committed row, and a slow/failing automations or
    // webhooks listener can never hold or roll back the create. We do NOT
    // implement those engines here.
    this.eventEmitter.emit(PROJECT_CREATED_EVENT, {
      workspaceId,
      projectId: project.id,
      actorId: user.id,
      project,
    } satisfies ProjectCreatedEvent);

    return project;
  }

  /**
   * Create a project inside an EXISTING workspace tx. Shared by {@link create}
   * and by other modules (e.g. triage's createProjectFromUnassigned) that
   * already hold a workspace-scoped transaction — calling this instead of
   * `create()` keeps the work in ONE runForUser (one membership authorization,
   * one GUC scope) and avoids a nested transaction.
   *
   * The project-number count runs in the SAME `tx` as the insert so the
   * sequence is computed against the workspace-scoped row set (under live RLS)
   * and is consistent with the row being created. The CREATE audit row is
   * written on this same `tx`: it references the new project id, which a
   * second connection cannot see until commit.
   */
  async createInTx(
    tx: WorkspaceTxClient,
    workspaceId: string,
    user: User,
    createProjectDto: CreateProjectDto,
  ): Promise<Project> {
    const projectNumber = await this.generateProjectNumber(tx);

    // Extract the non-column DTO fields. `projectType` and `customFields` are
    // NOT Prisma columns — they live inside metadata. `recurrenceRule` IS a
    // column and flows through projectDataFields unchanged.
    const { projectType, customFields, ...projectDataFields } = createProjectDto;

    // Prepare metadata: fold in projectType, then validate + merge custom-field
    // values (in-tx, so the validator's field-def reads are tenant-scoped).
    const metadataWithType = projectType
      ? { ...createProjectDto.metadata, projectType }
      : createProjectDto.metadata;
    const metadata = await this.resolveMetadataWithCustomFields(
      tx,
      workspaceId,
      metadataWithType,
      customFields,
    );

    const projectData = await tx.project.create({
      data: {
        ...this.coerceDateFields(projectDataFields),
        metadata,
        projectNumber,
        workspaceId,
        createdById: user.id,
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

    // Same transaction as the insert. log() otherwise opens a second
    // connection; the new project is not committed yet, and
    // audit_logs_projectId_fkey cannot see it.
    await this.auditService.log(
      {
        workspaceId,
        userId: user.id,
        projectId: projectData.id,
        action: 'CREATE',
        resource: 'Project',
        resourceId: projectData.id,
        details: { projectNumber: projectData.projectNumber },
      },
      tx,
    );

    this.logger.log(
      `Project created: ${projectData.projectNumber} by user ${user.id} ws=${workspaceId}`,
    );
    return projectData;
  }

  /**
   * List projects for the active workspace (paginated). Each returned project is
   * enriched with `taskStats: { total, completed }` so the master-schedule UI can
   * show progress without N+1 fetches. `category` and `tags` are scalar fields on
   * Project and are returned automatically (the query uses `include`, not an
   * explicit `select`, so all scalars come back).
   *
   * Task counts are gathered with a SINGLE `task.groupBy` over the page's project
   * ids (run on the same workspace `tx` so RLS holds), then folded into a Map and
   * attached — no per-project query.
   */
  async findAll(
    workspaceId: string,
    user: User,
    params?: {
      skip?: number;
      take?: number;
      where?: Prisma.ProjectWhereInput;
      orderBy?: Prisma.ProjectOrderByWithRelationInput;
    },
  ): Promise<{ projects: ProjectWithTaskStats[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [projects, total] = await Promise.all([
          tx.project.findMany({
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
          tx.project.count({ where }),
        ]);

        const [statsByProject, loggedSecondsByProject] = await Promise.all([
          this.buildTaskStats(tx, projects),
          this.buildLoggedSeconds(tx, projects),
        ]);

        const enriched: ProjectWithTaskStats[] = projects.map((project) => ({
          ...project,
          taskStats: statsByProject.get(project.id) ?? { total: 0, completed: 0 },
          budgetSummary: this.toBudgetSummary(project, loggedSecondsByProject.get(project.id) ?? 0),
        }));

        // CLIENT-role mask on the LIST surface (same serializer as get_project):
        // strips the commercial columns, the quote foreign ids, and the
        // `budgetSummary` rollup. Staff/admin rows pass through untouched.
        return { projects: enriched.map((p) => withProjectQuote(p, user)), total };
      },
      workspaceId,
    );
  }

  /**
   * Aggregate task counts for a page of projects with a SINGLE grouped query
   * (no N+1). Runs on the passed workspace `tx` so it stays inside the same RLS
   * GUC scope as the projects fetch. Returns a Map keyed by projectId; projects
   * with no tasks are simply absent (callers default to {total:0, completed:0}).
   */
  private async buildTaskStats(
    tx: WorkspaceTxClient,
    projects: { id: string }[],
  ): Promise<Map<string, TaskStats>> {
    const statsByProject = new Map<string, TaskStats>();
    if (projects.length === 0) {
      return statsByProject;
    }

    const projectIds = projects.map((p) => p.id);
    const grouped = await tx.task.groupBy({
      by: ['projectId', 'status'],
      where: { projectId: { in: projectIds } },
      _count: { _all: true },
    });

    for (const row of grouped) {
      const count = row._count._all;
      const current = statsByProject.get(row.projectId) ?? {
        total: 0,
        completed: 0,
      };
      current.total += count;
      if (row.status === TaskStatus.COMPLETED) {
        current.completed += count;
      }
      statsByProject.set(row.projectId, current);
    }

    return statsByProject;
  }

  /**
   * Sum logged seconds for a page of projects with a SINGLE grouped query (no
   * N+1), mirroring {@link buildTaskStats}. Uses the billable seconds after
   * rounding when present, else the raw duration — the same convention the
   * billing rollup and reports use (`roundingAppliedSeconds ?? durationSeconds`).
   * Runs on the passed workspace `tx` so it stays in the same RLS GUC scope.
   * Returns a Map keyed by projectId; projects with no entries are absent
   * (callers default to 0).
   */
  private async buildLoggedSeconds(
    tx: WorkspaceTxClient,
    projects: { id: string }[],
  ): Promise<Map<string, number>> {
    const byProject = new Map<string, number>();
    if (projects.length === 0) {
      return byProject;
    }

    const projectIds = projects.map((p) => p.id);
    const grouped = await tx.timeEntry.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds } },
      _sum: { durationSeconds: true, roundingAppliedSeconds: true },
    });

    for (const row of grouped) {
      const seconds = row._sum.roundingAppliedSeconds ?? row._sum.durationSeconds ?? 0;
      byProject.set(row.projectId, seconds);
    }
    return byProject;
  }

  /** Fold a project's budget fields + logged seconds into the list summary. */
  private toBudgetSummary(
    project: { budgetHours: Decimal | null; budgetAmount: Decimal | null },
    loggedSeconds: number,
  ): ProjectBudgetSummary {
    const budgetHours = decToNum(project.budgetHours);
    const loggedHours = secondsToHours(loggedSeconds);
    return {
      budgetHours,
      budgetAmount: project.budgetAmount !== null ? project.budgetAmount.toString() : null,
      loggedHours,
      pctHours: pct(loggedHours, budgetHours),
    };
  }

  /**
   * Budget burn-down for a single project: hours logged vs. the project's hour
   * budget, and accrued billable value vs. the amount budget. The billable value
   * REUSES the billing pipeline output stored on each time entry
   * (`billableAmount`, computed at write time by EntryFinancialsService via the
   * rate resolver + rounding) — this method never re-resolves rates or re-rounds.
   *
   * SUITE TENANCY: runs inside the workspace RLS tx; the project read and the
   * time-entry aggregates share one GUC scope. A project from another workspace
   * 404s (fail-closed) rather than leaking.
   */
  async getBudget(workspaceId: string, user: User, projectId: string): Promise<ProjectBudget> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const project = await tx.project.findUnique({
          where: { id: projectId },
          select: { id: true, budgetHours: true, budgetAmount: true },
        });
        if (!project) {
          throw new NotFoundException(`Project with ID ${projectId} not found`);
        }

        // One aggregate for all logged hours, one for billable hours + accrued
        // billable value (the stored, already-rated/rounded amount).
        const [allAgg, billableAgg] = await Promise.all([
          tx.timeEntry.aggregate({
            where: { projectId },
            _sum: { durationSeconds: true, roundingAppliedSeconds: true },
          }),
          tx.timeEntry.aggregate({
            where: { projectId, billable: true },
            _sum: {
              durationSeconds: true,
              roundingAppliedSeconds: true,
              billableAmount: true,
            },
          }),
        ]);

        const budgetHours = decToNum(project.budgetHours);
        const budgetAmount = decToNum(project.budgetAmount);

        const loggedHours = secondsToHours(
          allAgg._sum.roundingAppliedSeconds ?? allAgg._sum.durationSeconds ?? 0,
        );
        const billableHours = secondsToHours(
          billableAgg._sum.roundingAppliedSeconds ?? billableAgg._sum.durationSeconds ?? 0,
        );
        // Accrued billable value (WIP + already billed). Decimal money formatted
        // to 2dp; null sum (no priced entries) is $0.00.
        const billedDecimal = new Decimal(billableAgg._sum.billableAmount ?? 0).toDecimalPlaces(
          2,
          Decimal.ROUND_HALF_UP,
        );
        const billedAmountNum = billedDecimal.toNumber();

        const pctHours = pct(loggedHours, budgetHours);
        const pctAmount = pct(billedAmountNum, budgetAmount);

        return {
          budgetHours,
          budgetAmount: project.budgetAmount !== null ? project.budgetAmount.toString() : null,
          loggedHours,
          billableHours,
          billedAmount: billedDecimal.toString(),
          pctHours,
          pctAmount,
          overBudgetHours: pctHours !== null && pctHours > 1,
          overBudgetAmount: pctAmount !== null && pctAmount > 1,
        };
      },
      workspaceId,
    );
  }

  async findOne(workspaceId: string, user: User, id: string): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.findUnique({
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

        return withProjectQuote(projectData, user);
      },
      workspaceId,
    );
  }

  async findByProjectNumber(
    workspaceId: string,
    user: User,
    projectNumber: string,
  ): Promise<Project> {
    // projectNumber is unique PER WORKSPACE (@@unique([workspaceId,
    // projectNumber])), not globally, so it is no longer a findUnique key.
    // Running inside runForUser pins the workspace RLS GUC, so once tenancy is
    // live this findFirst is fenced to the active workspace; in Phase 1's
    // single bootstrap workspace it returns the same row. Scoped per R1.
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.findFirst({
          where: { projectNumber },
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
          },
        });

        if (!projectData) {
          throw new NotFoundException(`Project ${projectNumber} not found`);
        }

        return projectData;
      },
      workspaceId,
    );
  }

  async update(
    workspaceId: string,
    user: User,
    id: string,
    updateProjectDto: UpdateProjectDto,
  ): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Extract the non-column fields. projectType + customFields live in
        // metadata; recurrenceRule is a real column carried by projectDataFields.
        const { projectType, customFields, ...projectDataFields } = updateProjectDto;

        // Fold projectType into the DTO's metadata, then validate + merge any
        // custom-field values (in-tx; throws if values were sent but no
        // CustomFieldsService is wired). Mirrors the tasks update path.
        const metadataWithType =
          projectType !== undefined
            ? { ...updateProjectDto.metadata, projectType }
            : updateProjectDto.metadata;
        const metadata = await this.resolveMetadataWithCustomFields(
          tx,
          workspaceId,
          metadataWithType,
          customFields,
        );

        if (projectDataFields.flatFeeAmount !== undefined) {
          const existing = await tx.project.findUnique({
            where: { id },
            select: { flatFeeAmount: true, flatFeeInvoicedAt: true },
          });
          if (existing?.flatFeeInvoicedAt) {
            const next =
              projectDataFields.flatFeeAmount == null
                ? null
                : new Decimal(projectDataFields.flatFeeAmount).toFixed(2);
            const previous =
              existing.flatFeeAmount == null
                ? null
                : new Decimal(existing.flatFeeAmount).toFixed(2);
            if (next !== previous) {
              throw new BadRequestException(
                'This project flat fee was already invoiced and cannot be changed',
              );
            }
          }
        }

        const projectData = await tx.project.update({
          where: { id },
          data: {
            ...this.coerceDateFields(projectDataFields),
            ...(metadata !== undefined && { metadata }),
          },
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
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'UPDATE',
          resource: 'Project',
          resourceId: id,
          details: updateProjectDto,
        });

        this.logger.log(
          `Project updated: ${projectData.projectNumber} by user ${user.id} ws=${workspaceId}`,
        );
        return projectData;
      },
      workspaceId,
    );
  }

  async updateStatus(
    workspaceId: string,
    user: User,
    id: string,
    status: ProjectStatus,
  ): Promise<Project> {
    const { project, fromStatus } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Read the CURRENT status first so we know the real transition (the
        // updated row would only ever show the new status). 404s a project
        // outside the workspace (fail-closed under RLS).
        const existing = await tx.project.findUnique({
          where: { id },
          select: { status: true },
        });
        if (!existing) {
          throw new NotFoundException(`Project with ID ${id} not found`);
        }
        const previousStatus = existing.status;

        const updateData: any = { status };

        if (status === ProjectStatus.COMPLETED) {
          updateData.completedAt = new Date();
        }

        const projectData = await tx.project.update({
          where: { id },
          data: updateData,
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
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'UPDATE',
          resource: 'Project',
          resourceId: id,
          details: { status, previousStatus },
        });

        this.logger.log(
          `Project status updated: ${projectData.projectNumber} ${previousStatus} -> ${status} ws=${workspaceId}`,
        );
        return { project: projectData, fromStatus: previousStatus };
      },
      workspaceId,
    );

    // Domain event AFTER commit, only when the status actually changed, for the
    // automations + webhooks engines (not implemented here).
    if (fromStatus !== status) {
      this.eventEmitter.emit(PROJECT_STATUS_CHANGED_EVENT, {
        workspaceId,
        projectId: id,
        fromStatus,
        toStatus: status,
        actorId: user.id,
        project,
      } satisfies ProjectStatusChangedEvent);
    }

    return project;
  }

  async assignProject(
    workspaceId: string,
    user: User,
    id: string,
    assignProjectDto: AssignProjectDto,
  ): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.update({
          where: { id },
          data: {
            assignedToId: assignProjectDto.assignedToId,
          },
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
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'UPDATE',
          resource: 'Project',
          resourceId: id,
          details: { assignedTo: assignProjectDto.assignedToId },
        });

        this.logger.log(
          `Project assigned: ${projectData.projectNumber} to user ${assignProjectDto.assignedToId} ws=${workspaceId}`,
        );
        return projectData;
      },
      workspaceId,
    );
  }

  async remove(workspaceId: string, user: User, id: string): Promise<Project> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projectData = await tx.project.delete({
          where: { id },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: id,
          action: 'DELETE',
          resource: 'Project',
          resourceId: id,
          details: { projectNumber: projectData.projectNumber },
        });

        this.logger.log(
          `Project deleted: ${projectData.projectNumber} by user ${user.id} ws=${workspaceId}`,
        );
        return projectData;
      },
      workspaceId,
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // Recurring projects (Wave 2)
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Public wrapper over {@link generateProjectNumber} so the recurrence service
   * (ProjectsRecurrenceService) mints instance numbers through the SAME
   * workspace-scoped sequence the interactive create path uses, inside its own
   * workspace tx. Kept here (not duplicated in the scheduler) so there is one
   * source of truth for project numbering.
   */
  async nextProjectNumber(tx: WorkspaceTxClient): Promise<string> {
    return this.generateProjectNumber(tx);
  }

  /**
   * Generate the next project number. Runs on the passed workspace `tx` so the
   * count is computed against the workspace-scoped row set (under live RLS) and
   * is consistent with the create it precedes — callers MUST invoke this inside
   * the same runForUser tx as the insert (see {@link createInTx}).
   */
  private async generateProjectNumber(tx: WorkspaceTxClient): Promise<string> {
    const year = new Date().getFullYear();
    const count = await tx.project.count({
      where: {
        createdAt: {
          gte: new Date(`${year}-01-01`),
        },
      },
    });

    const sequence = (count + 1).toString().padStart(6, '0');
    return `PROJ-${year}-${sequence}`;
  }

  async getStatsByStatus(workspaceId: string, user: User): Promise<any> {
    const where = await this.buildRoleBasedWhere(user, workspaceId);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const stats = await tx.project.groupBy({
          by: ['status'],
          where,
          _count: true,
        });

        return stats.reduce((acc, stat) => {
          acc[stat.status] = stat._count;
          return acc;
        }, {});
      },
      workspaceId,
    );
  }

  async getStatsByPriority(workspaceId: string, user: User): Promise<any> {
    const where = await this.buildRoleBasedWhere(user, workspaceId);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const stats = await tx.project.groupBy({
          by: ['priority'],
          where,
          _count: true,
        });

        return stats.reduce((acc, stat) => {
          acc[stat.priority] = stat._count;
          return acc;
        }, {});
      },
      workspaceId,
    );
  }

  /**
   * Build where clause based on user role for row-level security
   */
  private async buildRoleBasedWhere(
    user: User,
    workspaceId: string,
  ): Promise<Prisma.ProjectWhereInput> {
    if (user.role === UserRole.CLIENT) {
      return { createdById: user.id };
    } else if (
      user.role === UserRole.STAFF &&
      !(await this.membership?.hasManagementRole(user, workspaceId))
    ) {
      return { assignedToId: user.id };
    }
    // ADMIN and MANAGER see all projects
    return {};
  }
}
