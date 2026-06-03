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
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SubmitTimesheetDto, ApproveTimeDto, RejectTimeDto } from './dto/timesheet.dto';

@Injectable()
export class TimesheetService {
  private readonly logger = new Logger(TimesheetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
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
    const anchor = dto.periodStart ? new Date(dto.periodStart) : new Date();
    const { periodStart, periodEnd } = this.weekBounds(anchor);

    const draftEntries = await this.prisma.timeEntry.findMany({
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

    const period = await this.prisma.timesheetPeriod.upsert({
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

    await this.prisma.timeEntry.updateMany({
      where: { id: { in: draftEntries.map((e) => e.id) } },
      data: { timesheetPeriodId: period.id, approvalStatus: 'SUBMITTED' },
    });

    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      resource: 'TimesheetPeriod',
      resourceId: period.id,
      details: { action: 'submit_timesheet', entryCount: draftEntries.length },
    });
    this.events.emit('timesheet.submitted', {
      timesheetPeriodId: period.id,
      userId: user.id,
      entryCount: draftEntries.length,
    });
    this.logger.log(
      `submit_timesheet: user=${user.email} period=${period.id} entries=${draftEntries.length}`,
    );

    return { ...period, entryCount: draftEntries.length };
  }

  // ── Approve ──────────────────────────────────────────────

  async approve(workspaceId: string, approver: User, dto: ApproveTimeDto) {
    this.assertApprover(approver);
    const now = new Date();

    const entryIds = await this.targetEntryIds(workspaceId, dto.timesheetPeriodId, dto.timeEntryIds, 'SUBMITTED');
    if (entryIds.length === 0) {
      throw new BadRequestException('No submitted time entries to approve');
    }

    const result = await this.prisma.timeEntry.updateMany({
      where: { id: { in: entryIds }, workspaceId, approvalStatus: 'SUBMITTED' },
      data: { approvalStatus: 'APPROVED', approvedById: approver.id, approvedAt: now, lockedAt: now },
    });

    if (dto.timesheetPeriodId) {
      await this.maybeClosePeriod(workspaceId, dto.timesheetPeriodId, approver.id, now);
    }

    await this.audit.log({
      userId: approver.id,
      action: 'UPDATE',
      resource: 'TimeEntry',
      details: { action: 'approve_time', count: result.count, periodId: dto.timesheetPeriodId },
    });
    this.events.emit('timesheet.approved', {
      timesheetPeriodId: dto.timesheetPeriodId ?? null,
      approvedBy: approver.id,
      count: result.count,
    });
    this.logger.log(`approve_time: approver=${approver.email} count=${result.count}`);

    return { approved: result.count };
  }

  // ── Reject ───────────────────────────────────────────────

  async reject(workspaceId: string, approver: User, dto: RejectTimeDto) {
    this.assertApprover(approver);
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('A rejection reason is required');
    }

    const entryIds = await this.targetEntryIds(workspaceId, dto.timesheetPeriodId, dto.timeEntryIds, 'SUBMITTED');
    if (entryIds.length === 0) {
      throw new BadRequestException('No submitted time entries to reject');
    }

    const result = await this.prisma.timeEntry.updateMany({
      where: { id: { in: entryIds }, workspaceId, approvalStatus: 'SUBMITTED' },
      data: { approvalStatus: 'DRAFT', rejectionReason: dto.reason, approvedById: null, approvedAt: null },
    });

    if (dto.timesheetPeriodId) {
      await this.prisma.timesheetPeriod.updateMany({
        where: { id: dto.timesheetPeriodId, workspaceId },
        data: { status: 'REJECTED', rejectionReason: dto.reason },
      });
    }

    await this.audit.log({
      userId: approver.id,
      action: 'UPDATE',
      resource: 'TimeEntry',
      details: { action: 'reject_time', count: result.count, reason: dto.reason },
    });
    this.events.emit('timesheet.rejected', {
      timesheetPeriodId: dto.timesheetPeriodId ?? null,
      rejectedBy: approver.id,
      count: result.count,
    });
    this.logger.log(`reject_time: approver=${approver.email} count=${result.count}`);

    return { rejected: result.count };
  }

  // ── internals ────────────────────────────────────────────

  /** Resolve the set of entry ids to act on (explicit ids, or all in a period). */
  private async targetEntryIds(
    workspaceId: string,
    periodId: string | undefined,
    explicitIds: string[] | undefined,
    requiredStatus: 'SUBMITTED',
  ): Promise<string[]> {
    if (explicitIds && explicitIds.length) {
      const rows = await this.prisma.timeEntry.findMany({
        where: { id: { in: explicitIds }, workspaceId, approvalStatus: requiredStatus },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    if (periodId) {
      const period = await this.prisma.timesheetPeriod.findFirst({
        where: { id: periodId, workspaceId },
        select: { id: true },
      });
      if (!period) throw new NotFoundException(`Timesheet period ${periodId} not found`);
      const rows = await this.prisma.timeEntry.findMany({
        where: { timesheetPeriodId: periodId, workspaceId, approvalStatus: requiredStatus },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    }
    throw new BadRequestException('Provide timesheetPeriodId or timeEntryIds');
  }

  /** Mark a period APPROVED once it has no remaining SUBMITTED entries. */
  private async maybeClosePeriod(workspaceId: string, periodId: string, approverId: string, when: Date) {
    const remaining = await this.prisma.timeEntry.count({
      where: { timesheetPeriodId: periodId, workspaceId, approvalStatus: 'SUBMITTED' },
    });
    if (remaining === 0) {
      await this.prisma.timesheetPeriod.updateMany({
        where: { id: periodId, workspaceId },
        data: { status: 'APPROVED', approvedById: approverId, approvedAt: when },
      });
    }
  }

  /** Week containing `date`. Week start day from WEEK_START_DAY (0=Sun..6=Sat, default 1=Mon). */
  private weekBounds(date: Date): { periodStart: Date; periodEnd: Date } {
    const weekStartDay = Number(this.config.get<string>('WEEK_START_DAY', '1')) || 1;
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const diff = (d.getUTCDay() - weekStartDay + 7) % 7;
    const periodStart = new Date(d);
    periodStart.setUTCDate(d.getUTCDate() - diff);
    periodStart.setUTCHours(0, 0, 0, 0);
    const periodEnd = new Date(periodStart);
    periodEnd.setUTCDate(periodStart.getUTCDate() + 7);
    periodEnd.setUTCMilliseconds(-1); // end of the 7th day
    return { periodStart, periodEnd };
  }
}
