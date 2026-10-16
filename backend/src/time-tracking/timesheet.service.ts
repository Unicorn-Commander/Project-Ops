import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User, UserRole } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { AuditService } from '../audit/audit.service';
import { SubmitTimesheetDto, ApproveTimeDto, RejectTimeDto } from './dto/timesheet.dto';
import { businessWeekBoundsUtc, parseBusinessDateInput } from '../common/time/business-time';

@Injectable()
export class TimesheetService {
  private readonly logger = new Logger(TimesheetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  private assertApprover(user: Pick<User, 'role'>) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Only MANAGER or ADMIN can approve or reject time');
    }
  }

  // ── Submit ───────────────────────────────────────────────

  async submit(workspaceId: string, user: User, dto: SubmitTimesheetDto) {
    if (user.role === UserRole.CLIENT) {
      throw new ForbiddenException('CLIENT users cannot submit timesheets');
    }
    const anchor = dto.periodStart ? parseBusinessDateInput(dto.periodStart) : new Date();
    const { periodStart, periodEnd } = this.weekBounds(anchor);

    // The draft scan + period upsert + entry updateMany + audit are ONE workspace
    // tx so they are RLS-scoped and atomic (the upsert and the bulk update can't
    // diverge across a partial failure).
    const { period, entryCount } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const draftEntries = await tx.timeEntry.findMany({
          where: {
            workspaceId,
            userId: user.id,
            approvalStatus: 'DRAFT',
            lockedAt: null,
            billed: false,
            endedAt: { not: null, gte: periodStart, lte: periodEnd },
          },
          select: { id: true },
        });
        if (draftEntries.length === 0) {
          throw new BadRequestException('No draft time entries to submit for this week');
        }

        const submitted = await tx.timesheetPeriod.upsert({
          where: {
            workspaceId_userId_periodStart: { workspaceId, userId: user.id, periodStart },
          },
          create: {
            workspaceId,
            userId: user.id,
            periodStart,
            periodEnd,
            status: 'SUBMITTED',
            submittedAt: new Date(),
          },
          update: {
            status: 'SUBMITTED',
            submittedAt: new Date(),
            rejectionReason: null,
          },
        });

        await tx.timeEntry.updateMany({
          where: { id: { in: draftEntries.map((e) => e.id) }, workspaceId },
          data: { timesheetPeriodId: submitted.id, approvalStatus: 'SUBMITTED' },
        });

        await this.audit.log({
          workspaceId,
          userId: user.id,
          action: 'UPDATE',
          resource: 'TimesheetPeriod',
          resourceId: submitted.id,
          details: { action: 'submit_timesheet', entryCount: draftEntries.length },
        });

        return { period: submitted, entryCount: draftEntries.length };
      },
      workspaceId,
    );

    this.events.emit('timesheet.submitted', {
      workspaceId,
      timesheetPeriodId: period.id,
      userId: user.id,
      entryCount,
    });
    this.logger.log(
      `submit_timesheet: user=${user.email} period=${period.id} entries=${entryCount}`,
    );

    return { ...period, entryCount };
  }

  // ── Approve ──────────────────────────────────────────────

  async approve(workspaceId: string, approver: User, dto: ApproveTimeDto) {
    this.assertApprover(approver);
    const now = new Date();

    // Target-id resolution + bulk approve + period close + audit are ONE
    // workspace tx (RLS-scoped, atomic).
    const { count, userIds } = await this.workspaceContext.runForUser(
      approver,
      async (tx) => {
        const entryIds = await this.targetEntryIds(
          tx,
          workspaceId,
          dto.timesheetPeriodId,
          dto.timeEntryIds,
          'SUBMITTED',
        );
        if (entryIds.length === 0) {
          throw new BadRequestException('No submitted time entries to approve');
        }

        const result = await tx.timeEntry.updateMany({
          where: { id: { in: entryIds }, workspaceId, approvalStatus: 'SUBMITTED' },
          data: {
            approvalStatus: 'APPROVED',
            approvedById: approver.id,
            approvedAt: now,
            lockedAt: now,
          },
        });

        if (dto.timesheetPeriodId) {
          await this.maybeClosePeriod(tx, workspaceId, dto.timesheetPeriodId, approver.id, now);
        }

        await this.audit.log({
          workspaceId,
          userId: approver.id,
          action: 'UPDATE',
          resource: 'TimeEntry',
          details: { action: 'approve_time', count: result.count, periodId: dto.timesheetPeriodId },
        });

        const recipients = await tx.timeEntry.findMany({
          where: { workspaceId, id: { in: entryIds } },
          select: { userId: true },
        });
        return {
          count: result.count,
          userIds: [...new Set(recipients.map((entry) => entry.userId))],
        };
      },
      workspaceId,
    );

    this.events.emit('timesheet.approved', {
      workspaceId,
      userIds,
      timesheetPeriodId: dto.timesheetPeriodId ?? null,
      approvedBy: approver.id,
      count,
    });
    this.logger.log(`approve_time: approver=${approver.email} count=${count}`);

    return { approved: count };
  }

  // ── Reject ───────────────────────────────────────────────

  async reject(workspaceId: string, approver: User, dto: RejectTimeDto) {
    this.assertApprover(approver);
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    // Target-id resolution + bulk reject + period status + audit are ONE
    // workspace tx (RLS-scoped, atomic).
    const { count, userIds } = await this.workspaceContext.runForUser(
      approver,
      async (tx) => {
        const entryIds = await this.targetEntryIds(
          tx,
          workspaceId,
          dto.timesheetPeriodId,
          dto.timeEntryIds,
          'SUBMITTED',
        );
        if (entryIds.length === 0) {
          throw new BadRequestException('No submitted time entries to reject');
        }

        const result = await tx.timeEntry.updateMany({
          where: { id: { in: entryIds }, workspaceId, approvalStatus: 'SUBMITTED' },
          data: {
            approvalStatus: 'DRAFT',
            rejectionReason: dto.reason,
            approvedById: null,
            approvedAt: null,
          },
        });

        if (dto.timesheetPeriodId) {
          await tx.timesheetPeriod.updateMany({
            where: { id: dto.timesheetPeriodId, workspaceId },
            data: { status: 'REJECTED', rejectionReason: dto.reason },
          });
        }

        await this.audit.log({
          workspaceId,
          userId: approver.id,
          action: 'UPDATE',
          resource: 'TimeEntry',
          details: { action: 'reject_time', count: result.count, reason: dto.reason },
        });

        const recipients = await tx.timeEntry.findMany({
          where: { workspaceId, id: { in: entryIds } },
          select: { userId: true },
        });
        return {
          count: result.count,
          userIds: [...new Set(recipients.map((entry) => entry.userId))],
        };
      },
      workspaceId,
    );

    this.events.emit('timesheet.rejected', {
      workspaceId,
      userIds,
      timesheetPeriodId: dto.timesheetPeriodId ?? null,
      rejectedBy: approver.id,
      count,
    });
    this.logger.log(`reject_time: approver=${approver.email} count=${count}`);

    return { rejected: count };
  }

  // ── internals ────────────────────────────────────────────

  /** Resolve the set of entry ids to act on (explicit ids, or all in a period). */
  private async targetEntryIds(
    tx: WorkspaceTxClient,
    workspaceId: string,
    periodId: string | undefined,
    explicitIds: string[] | undefined,
    requiredStatus: 'SUBMITTED',
  ): Promise<string[]> {
    if (explicitIds && explicitIds.length) {
      const rows = await tx.timeEntry.findMany({
        where: { id: { in: explicitIds }, workspaceId, approvalStatus: requiredStatus },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    if (periodId) {
      const period = await tx.timesheetPeriod.findFirst({
        where: { id: periodId, workspaceId },
        select: { id: true },
      });
      if (!period) throw new NotFoundException(`Timesheet period ${periodId} not found`);
      const rows = await tx.timeEntry.findMany({
        where: { timesheetPeriodId: periodId, workspaceId, approvalStatus: requiredStatus },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    throw new BadRequestException('Provide timesheetPeriodId or timeEntryIds');
  }

  /** Mark a period APPROVED once it has no remaining SUBMITTED entries. */
  private async maybeClosePeriod(
    tx: WorkspaceTxClient,
    workspaceId: string,
    periodId: string,
    approverId: string,
    when: Date,
  ) {
    const remaining = await tx.timeEntry.count({
      where: { timesheetPeriodId: periodId, workspaceId, approvalStatus: 'SUBMITTED' },
    });
    if (remaining === 0) {
      await tx.timesheetPeriod.updateMany({
        where: { id: periodId, workspaceId },
        data: { status: 'APPROVED', approvedById: approverId, approvedAt: when },
      });
    }
  }

  /** Week containing `date`. Week start day from WEEK_START_DAY (0=Sun..6=Sat, default 1=Mon). */
  private weekBounds(date: Date): { periodStart: Date; periodEnd: Date } {
    const configured = Number(this.config.get<string>('WEEK_START_DAY', '1'));
    const weekStartDay =
      Number.isInteger(configured) && configured >= 0 && configured <= 6 ? configured : 1;
    const bounds = businessWeekBoundsUtc(date, weekStartDay);
    return { periodStart: bounds.from, periodEnd: bounds.to };
  }
}
