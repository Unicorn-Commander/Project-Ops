import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoundingMode, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { RateResolverService } from './rate-resolver.service';
import { RoundingService, RoundingConfig } from './rounding.service';

export interface ComputeInput {
  workspaceId: string;
  userId: string;
  role?: UserRole | null;
  projectId: string;
  taskId?: string | null;
  startedAt: Date;
  endedAt: Date;
  billable: boolean;
}

export interface ComputedFinancials {
  durationSeconds: number;
  roundingAppliedSeconds: number;
  billRateApplied: Decimal | null;
  costRateApplied: Decimal | null;
  currency: string;
  billableAmount: Decimal | null;
}

export interface BillablePolicy {
  projectId: string;
  billable: boolean;
}

/**
 * Shared financial computation for time entries: rounding + rate resolution +
 * billableAmount. Used by the timer (on stop), manual entry, and edits so the
 * math is identical everywhere. All money is Decimal, rounded HALF_UP to cents.
 *
 * SUITE TENANCY: this is a helper that runs INSIDE the caller's workspace RLS
 * transaction — every method takes the `tx` (WorkspaceTxClient) and does all DB
 * access through it, never `this.prisma`. It never opens its own runForUser /
 * $transaction (a nested transaction would be a savepoint, risking the GUC on a
 * savepoint rollback and wasting a connection). Callers must already hold the tx.
 */
@Injectable()
export class EntryFinancialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateResolver: RateResolverService,
    private readonly rounding: RoundingService,
  ) {}

  /**
   * Resolve whether an entry should be billable by default, from the task
   * override then the project policy. Also returns the effective projectId
   * (resolved from a task when only taskId is supplied).
   */
  async resolveBillablePolicy(
    tx: WorkspaceTxClient,
    projectId?: string | null,
    taskId?: string | null,
  ): Promise<BillablePolicy> {
    let resolvedProjectId = projectId ?? null;
    let taskBillable: boolean | null = null;

    if (taskId) {
      const task = await tx.task.findUnique({
        where: { id: taskId },
        select: { projectId: true, billable: true },
      });
      if (!task) throw new NotFoundException(`Task with ID ${taskId} not found`);
      resolvedProjectId = task.projectId;
      taskBillable = task.billable;
    }

    if (!resolvedProjectId) {
      throw new NotFoundException('A projectId or taskId is required');
    }

    if (taskBillable !== null) {
      return { projectId: resolvedProjectId, billable: taskBillable };
    }

    const project = await tx.project.findUnique({
      where: { id: resolvedProjectId },
      select: { billByDefault: true },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID ${resolvedProjectId} not found`);
    }
    return { projectId: resolvedProjectId, billable: project.billByDefault };
  }

  async compute(tx: WorkspaceTxClient, input: ComputeInput): Promise<ComputedFinancials> {
    const rawSeconds = Math.max(
      0,
      Math.floor((input.endedAt.getTime() - input.startedAt.getTime()) / 1000),
    );

    const project = await tx.project.findUnique({
      where: { id: input.projectId },
      select: {
        defaultBillRate: true,
        roundingMode: true,
        roundingIncrementMinutes: true,
        organizationId: true,
        contactId: true,
      },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID ${input.projectId} not found`);
    }

    let taskBillRate: Prisma.Decimal | null = null;
    let taskType: any = null;
    if (input.taskId) {
      const task = await tx.task.findUnique({
        where: { id: input.taskId },
        select: { billRate: true, type: true },
      });
      taskBillRate = task?.billRate ?? null;
      taskType = task?.type ?? null;
    }

    const roundingConfig = await this.resolveRoundingConfig(tx, project);
    const roundedSeconds = this.rounding.apply(rawSeconds, roundingConfig);

    const rate = await this.rateResolver.resolve(tx, {
      workspaceId: input.workspaceId,
      date: input.startedAt,
      userId: input.userId,
      role: input.role ?? null,
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      taskType,
      contactId: project.contactId,
      organizationId: project.organizationId,
      taskBillRate,
      projectDefaultBillRate: project.defaultBillRate,
    });

    let billableAmount: Decimal | null = null;
    if (input.billable && rate.billRate) {
      billableAmount = new Decimal(rate.billRate)
        .mul(roundedSeconds)
        .div(3600)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }

    return {
      durationSeconds: rawSeconds,
      roundingAppliedSeconds: roundedSeconds,
      billRateApplied: rate.billRate,
      costRateApplied: rate.costRate,
      currency: rate.currency,
      billableAmount,
    };
  }

  /** Project rounding policy → tenant default (SystemConfig) → NONE. */
  private async resolveRoundingConfig(
    tx: WorkspaceTxClient,
    project: {
      roundingMode: RoundingMode | null;
      roundingIncrementMinutes: number | null;
    },
  ): Promise<RoundingConfig> {
    if (project.roundingMode && project.roundingMode !== RoundingMode.NONE) {
      return {
        mode: project.roundingMode,
        incrementMinutes: project.roundingIncrementMinutes,
      };
    }

    const cfg = await tx.systemConfig.findUnique({
      where: { key: 'time_tracking.rounding' },
    });
    if (cfg && cfg.value && typeof cfg.value === 'object') {
      const v = cfg.value as any;
      if (v.mode && v.mode !== RoundingMode.NONE) {
        return { mode: v.mode as RoundingMode, incrementMinutes: Number(v.incrementMinutes) || 0 };
      }
    }
    return { mode: RoundingMode.NONE, incrementMinutes: 0 };
  }
}
