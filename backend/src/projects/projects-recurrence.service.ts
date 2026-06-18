import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma, Project } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { ProjectsService } from './projects.service';
import { nextOccurrenceAfter, parseRecurrenceRule } from './recurrence.util';

/**
 * Materializes recurring-project instances on a schedule (Wave 2).
 *
 * Mirrors TasksRecurrenceService one-to-one. A recurrence TEMPLATE is a project
 * with `recurrenceRule` set and `recurrenceParentId` null. Each spawned INSTANCE
 * copies the template's descriptive + classification + billing-policy fields,
 * gets a fresh workspace-scoped projectNumber, points `recurrenceParentId` at the
 * template, carries the computed `dueDate`, and has `recurrenceRule = null`
 * (instances never themselves spawn).
 *
 * SUITE TENANCY (§6, mirrors InvoiceStatusPoller / TasksRecurrenceService): the
 * cron runs with NO request user, and under live RLS a cross-workspace scan is
 * illegal. So we read the `workspaces` control-plane table directly via
 * PrismaService (it is NOT under RLS), then run ONE workspace-scoped pass per
 * active tenant inside that workspace's RLS tx via
 * WorkspaceContextService.runInWorkspace (app.uc_uid = '' — no acting user).
 *
 * IDEMPOTENCY: per template we anchor on the latest already-spawned instance
 * dueDate (or the template's own dueDate / createdAt when there are none),
 * compute the NEXT occurrence strictly after that anchor, and create it only
 * when (a) it is due within a one-day look-ahead, and (b) no sibling instance
 * already carries that dueDate. Re-running the cron never double-creates an
 * occurrence.
 */
@Injectable()
export class ProjectsRecurrenceService {
  private readonly logger = new Logger(ProjectsRecurrenceService.name);

  // Spawn an instance once we are within this window of its due date, so a
  // project due tomorrow appears today. One day matches the daily cron cadence.
  private static readonly LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * Daily at ~02:00 (offset from the tasks recurrence cron at 01:00 so the two
   * sweeps don't contend). Iterates active workspaces and materializes due
   * recurring project instances in each. Named so it can be triggered directly
   * in tests.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async materializeDueRecurrences(now: Date = new Date()): Promise<void> {
    // Control-plane read (NOT RLS-scoped): every active tenant workspace.
    const workspaces = await this.prisma.workspace.findMany({
      where: { status: 'active' },
      select: { id: true },
    });

    let totalCreated = 0;
    for (const ws of workspaces) {
      try {
        totalCreated += await this.materializeForWorkspace(ws.id, now);
      } catch (err) {
        this.logger.warn(
          `Recurrence materialization failed for ws=${ws.id}: ${(err as Error).message}`,
        );
      }
    }

    if (totalCreated) {
      this.logger.log(
        `Recurrence: spawned ${totalCreated} project instance(s) across ${workspaces.length} workspace(s)`,
      );
    }
  }

  /**
   * Run one workspace's recurrence pass inside its RLS tx. Returns the number of
   * instances created. Exposed (non-private) so it can be unit-tested directly.
   */
  async materializeForWorkspace(workspaceId: string, now: Date = new Date()): Promise<number> {
    return this.workspaceContext.runInWorkspace(workspaceId, '', async (tx) => {
      // Templates: rule set + not themselves an instance. RLS already fences to
      // this workspace; the workspaceId filter is belt-and-suspenders.
      const templates = await tx.project.findMany({
        where: {
          workspaceId,
          recurrenceParentId: null,
          NOT: { recurrenceRule: null },
        },
      });

      let created = 0;
      for (const template of templates) {
        if (await this.spawnNextInstance(tx, workspaceId, template, now)) {
          created++;
        }
      }
      return created;
    });
  }

  /**
   * Materialize the next due instance for a single template, if any. Returns
   * true when an instance was created. Idempotent: anchors on the latest
   * existing instance dueDate and skips if an instance already exists at the
   * computed occurrence.
   */
  private async spawnNextInstance(
    tx: WorkspaceTxClient,
    workspaceId: string,
    template: Project,
    now: Date,
  ): Promise<boolean> {
    const parsed = parseRecurrenceRule(template.recurrenceRule);
    if (!parsed) {
      // Unparseable / unsupported rule → not a spawning template.
      return false;
    }

    // Anchor = latest spawned instance dueDate, else the template's own dueDate,
    // else its createdAt. The cadence walks forward from the anchor.
    const latestInstance = await tx.project.findFirst({
      where: { recurrenceParentId: template.id },
      orderBy: { dueDate: 'desc' },
      select: { dueDate: true },
    });

    const anchor = latestInstance?.dueDate ?? template.dueDate ?? template.createdAt;

    const nextDue = nextOccurrenceAfter(template.recurrenceRule, anchor, anchor);
    if (!nextDue) {
      return false;
    }

    // Only spawn once we're within the look-ahead window of the due date.
    if (nextDue.getTime() > now.getTime() + ProjectsRecurrenceService.LOOKAHEAD_MS) {
      return false;
    }

    // Idempotency guard: never create two instances for the same occurrence.
    const existing = await tx.project.findFirst({
      where: { recurrenceParentId: template.id, dueDate: nextDue },
      select: { id: true },
    });
    if (existing) {
      return false;
    }

    // Mint the instance's number through the canonical (workspace-scoped)
    // sequence, in this same tx.
    const projectNumber = await this.projects.nextProjectNumber(tx);

    await tx.project.create({
      data: {
        workspaceId,
        projectNumber,
        // Copy the descriptive + classification + billing-policy fields; the
        // instance is a concrete, NON-template project.
        title: template.title,
        description: template.description,
        // status defaults to NEW; the instance is a fresh, open project.
        priority: template.priority,
        category: template.category,
        tags: template.tags === null ? Prisma.JsonNull : template.tags,
        clientName: template.clientName,
        clientEmail: template.clientEmail,
        clientPhone: template.clientPhone,
        contactId: template.contactId,
        organizationId: template.organizationId,
        assignedToId: template.assignedToId,
        createdById: template.createdById,
        billByDefault: template.billByDefault,
        defaultBillRate: template.defaultBillRate,
        budgetHours: template.budgetHours,
        budgetAmount: template.budgetAmount,
        roundingIncrementMinutes: template.roundingIncrementMinutes,
        roundingMode: template.roundingMode,
        metadata: template.metadata === null ? Prisma.JsonNull : template.metadata,
        // Instance-specific:
        recurrenceParentId: template.id,
        recurrenceRule: null,
        dueDate: nextDue,
      },
    });

    this.logger.log(
      `Recurrence: spawned instance of template ${template.projectNumber} due ${nextDue.toISOString()} (ws=${workspaceId})`,
    );
    return true;
  }
}
