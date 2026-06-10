import { Injectable } from '@nestjs/common';
import { Prisma, User, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { buildTimeEntryVisibilityFilter } from '../common/workspace/time-entry-visibility';
import { decToNum } from './serialize';

export interface Period {
  from?: string;
  to?: string;
}

function hours(seconds: number | null | undefined): number {
  return Math.round(((seconds || 0) / 3600) * 100) / 100;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  private periodWhere(user: User, workspaceId: string, period: Period): Prisma.TimeEntryWhereInput {
    const where: Prisma.TimeEntryWhereInput = {
      ...buildTimeEntryVisibilityFilter(user, workspaceId),
      endedAt: { not: null },
    };
    if (period.from || period.to) {
      const range: Prisma.DateTimeNullableFilter = { not: null };
      if (period.from) range.gte = new Date(period.from);
      if (period.to) range.lte = new Date(period.to);
      where.endedAt = range;
    }
    return where;
  }

  /** Utilization = billable hours / total hours, per user. */
  async getUtilization(workspaceId: string, user: User, period: Period & { userId?: string }) {
    const where = this.periodWhere(user, workspaceId, period);
    if (period.userId) where.userId = period.userId;

    const { totals, billableByUser, userById } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [totalsRows, billables] = await Promise.all([
          tx.timeEntry.groupBy({ by: ['userId'], where, _sum: { durationSeconds: true } }),
          tx.timeEntry.groupBy({
            by: ['userId'],
            where: { ...where, billable: true },
            _sum: { durationSeconds: true },
          }),
        ]);

        const billableMap = new Map(billables.map((b) => [b.userId, b._sum.durationSeconds || 0]));
        const userIds = totalsRows.map((t) => t.userId);
        const users = await tx.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, firstName: true, lastName: true, email: true },
        });
        const usersById = new Map(users.map((u) => [u.id, u]));
        return { totals: totalsRows, billableByUser: billableMap, userById: usersById };
      },
      workspaceId,
    );

    const rows = totals.map((t) => {
      const totalSeconds = t._sum.durationSeconds || 0;
      const billableSeconds = billableByUser.get(t.userId) || 0;
      const u = userById.get(t.userId);
      return {
        userId: t.userId,
        name: u ? `${u.firstName} ${u.lastName}`.trim() : t.userId,
        email: u?.email,
        totalHours: hours(totalSeconds),
        billableHours: hours(billableSeconds),
        utilization: totalSeconds > 0 ? Math.round((billableSeconds / totalSeconds) * 1000) / 10 : 0,
      };
    });

    return { period, rows };
  }

  /** Realization = billed amount / billable amount over the period. */
  async getRealization(workspaceId: string, user: User, period: Period) {
    const where = this.periodWhere(user, workspaceId, period);

    const [billable, billed] = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        Promise.all([
          tx.timeEntry.aggregate({
            where: { ...where, billable: true },
            _sum: { billableAmount: true },
          }),
          tx.timeEntry.aggregate({
            where: { ...where, billable: true, billed: true },
            _sum: { billableAmount: true },
          }),
        ]),
      workspaceId,
    );

    const billableAmount = decToNum(billable._sum.billableAmount) || 0;
    const billedAmount = decToNum(billed._sum.billableAmount) || 0;
    return {
      period,
      billableAmount,
      billedAmount,
      realization: billableAmount > 0 ? Math.round((billedAmount / billableAmount) * 1000) / 10 : 0,
    };
  }

  /** WIP = approved, billable, unbilled value, grouped by project. */
  async getWip(workspaceId: string, user: User) {
    const where: Prisma.TimeEntryWhereInput = {
      ...buildTimeEntryVisibilityFilter(user, workspaceId),
      approvalStatus: 'APPROVED',
      billable: true,
      billed: false,
    };

    const { grouped, byId } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const groupedRows = await tx.timeEntry.groupBy({
          by: ['projectId'],
          where,
          _sum: { billableAmount: true, roundingAppliedSeconds: true },
        });

        const projects = await tx.project.findMany({
          where: { id: { in: groupedRows.map((g) => g.projectId) } },
          select: { id: true, projectNumber: true, title: true, clientName: true },
        });
        return { grouped: groupedRows, byId: new Map(projects.map((p) => [p.id, p])) };
      },
      workspaceId,
    );

    const rows = grouped.map((g) => ({
      projectId: g.projectId,
      project: byId.get(g.projectId),
      wipAmount: decToNum(g._sum.billableAmount) || 0,
      wipHours: hours(g._sum.roundingAppliedSeconds),
    }));
    const totalWip = rows.reduce((s, r) => s + r.wipAmount, 0);

    return { totalWip: Math.round(totalWip * 100) / 100, rows };
  }

  /** CSV export of entries in scope. Never includes cost/margin columns. */
  async exportCsv(workspaceId: string, user: User, period: Period & { projectId?: string }) {
    const where = this.periodWhere(user, workspaceId, period);
    if (period.projectId) where.projectId = period.projectId;

    const entries = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.timeEntry.findMany({
          where,
          orderBy: { startedAt: 'asc' },
          include: {
            user: { select: { firstName: true, lastName: true, email: true } },
            project: { select: { projectNumber: true, title: true } },
            task: { select: { title: true } },
          },
        }),
      workspaceId,
    );

    const headers = [
      'Date',
      'User',
      'Project',
      'Task',
      'Description',
      'Hours',
      'Billable',
      'Bill Rate',
      'Amount',
      'Currency',
      'Approval',
      'Billed',
      'Invoice Ref',
    ];
    const lines = [headers.join(',')];
    const isClient = user.role === UserRole.CLIENT;
    for (const e of entries) {
      const row = [
        e.startedAt.toISOString().slice(0, 10),
        e.user ? `${e.user.firstName} ${e.user.lastName}`.trim() : e.userId,
        e.project ? e.project.projectNumber : e.projectId,
        e.task?.title ?? '',
        e.description ?? '',
        hours(e.roundingAppliedSeconds ?? e.durationSeconds).toString(),
        e.billable ? 'yes' : 'no',
        isClient ? '' : (decToNum(e.billRateApplied) ?? '').toString(),
        (decToNum(e.billableAmount) ?? '').toString(),
        e.currency,
        e.approvalStatus,
        e.billed ? 'yes' : 'no',
        e.invoiceRef ?? '',
      ].map((c) => this.csvCell(c));
      lines.push(row.join(','));
    }
    return lines.join('\n');
  }

  private csvCell(value: string): string {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }
}
