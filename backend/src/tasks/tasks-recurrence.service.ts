import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { nextOccurrenceAfter, parseRecurrenceRule } from './recurrence.util';
import { Prisma, Task } from '@prisma/client';

/**
 * Materializes recurring-task instances on a schedule (Wave 2).
 *
 * A recurrence TEMPLATE is a task with `recurrenceRule` set and
 * `recurrenceParentId` null. Each spawned INSTANCE copies the template's
 * content, points `recurrenceParentId` at the template, carries the computed
 * `dueDate`, and has `recurrenceRule = null` (instances never themselves spawn).
 *
 * SUITE TENANCY (§6, mirrors InvoiceStatusPoller): the cron runs with NO request
 * user, and under live RLS a cross-workspace scan is illegal. So we read the
 * `workspaces` control-plane table directly via PrismaService (it is NOT under
 * RLS), then run ONE workspace-scoped pass per active tenant inside that
 * workspace's RLS tx via WorkspaceContextService.runInWorkspace. The system pass
 * sets app.uc_uid = '' (no acting user).
 *
 * IDEMPOTENCY: per template we anchor on the latest already-spawned instance
 * dueDate (or the template's own dueDate / createdAt when there are none),
 * compute the NEXT occurrence strictly after that anchor, and create it only
 * when (a) it is due — its dueDate is at or before a small look-ahead horizon —
 * and (b) no sibling instance already carries that dueDate. Re-running the cron
 * (or running it twice in a day) therefore never double-creates an occurrence.
 */
@Injectable()
export class TasksRecurrenceService {
  private readonly logger = new Logger(TasksRecurrenceService.name);

  // Spawn an instance once we are within this window of its due date, so a task
  // due tomorrow appears today. One day matches the daily cron cadence.
  private static readonly LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  /**
   * Daily at ~01:00. Iterates active workspaces and materializes due recurring
   * task instances in each. Named so it can be triggered directly in tests.
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
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
        `Recurrence: spawned ${totalCreated} task instance(s) across ${workspaces.length} workspace(s)`,
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
      const templates = await tx.task.findMany({
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
    template: Task,
    now: Date,
  ): Promise<boolean> {
    const parsed = parseRecurrenceRule(template.recurrenceRule);
    if (!parsed) {
      // Unparseable / unsupported rule → not a spawning template.
      return false;
    }

    // Anchor = latest spawned instance dueDate, else the template's own dueDate,
    // else its createdAt. The cadence walks forward from the anchor.
    const latestInstance = await tx.task.findFirst({
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
    if (nextDue.getTime() > now.getTime() + TasksRecurrenceService.LOOKAHEAD_MS) {
      return false;
    }

    // Idempotency guard: never create two instances for the same occurrence.
    const existing = await tx.task.findFirst({
      where: { recurrenceParentId: template.id, dueDate: nextDue },
      select: { id: true },
    });
    if (existing) {
      return false;
    }

    await tx.task.create({
      data: {
        workspaceId,
        projectId: template.projectId,
        title: template.title,
        description: template.description,
        type: template.type,
        priority: template.priority,
        assignedToId: template.assignedToId,
        estimatedHours: template.estimatedHours,
        createdById: template.createdById,
        recurrenceParentId: template.id,
        recurrenceRule: null,
        dueDate: nextDue,
        // status defaults to PENDING; the instance is a fresh, open task.
        metadata: template.metadata === null ? Prisma.JsonNull : template.metadata,
      },
    });

    this.logger.log(
      `Recurrence: spawned instance of template ${template.id} due ${nextDue.toISOString()} (ws=${workspaceId})`,
    );
    return true;
  }
}
