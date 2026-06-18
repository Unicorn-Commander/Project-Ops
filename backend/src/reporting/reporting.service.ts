import { Injectable } from '@nestjs/common';
import { Prisma, ProjectStatus, TaskStatus, User, UserRole } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { buildTimeEntryVisibilityFilter } from '../common/workspace/time-entry-visibility';

/**
 * Portfolio + profitability + throughput reporting (Wave 2).
 *
 * SUITE TENANCY: every query runs inside the acting user's workspace RLS tx via
 * WorkspaceContextService.runForUser, through the passed `tx` — never
 * `this.prisma`. Role visibility for time-entry money mirrors the time-tracking
 * reports (buildTimeEntryVisibilityFilter), and CLIENT viewers never see cost or
 * margin (profitability is MANAGER/ADMIN-only at the controller, and cost is
 * additionally omitted here for non-privileged roles).
 *
 * MONEY REUSE: this service NEVER re-resolves bill rates or re-rounds time. It
 * aggregates the already-priced `billableAmount` that EntryFinancialsService
 * computed and stored on each TimeEntry (same convention as ReportsService /
 * ProjectsService.getBudget). Cost basis uses the stored `costRateApplied`
 * applied to the stored billable seconds — again, no rate re-resolution.
 *
 * EFFICIENCY: rollups use a single groupBy/aggregate over the relevant rows
 * (keyed by projectId) and fold the results into Maps — no per-project query.
 */

export interface Period {
  from?: string;
  to?: string;
}

/** Chart-friendly point. */
export interface SeriesPoint {
  label: string;
  value: number;
}

function hours(seconds: number | null | undefined): number {
  return Math.round(((seconds || 0) / 3600) * 100) / 100;
}

function money(d: Decimal | number | null | undefined): number {
  if (d === null || d === undefined) return 0;
  return new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** actual/budget as a percentage (1dp), or null when there's no budget. */
function pctOf(actual: number, budget: number | null): number | null {
  if (budget === null || budget === 0) return null;
  return Math.round((actual / budget) * 1000) / 10;
}

function decToNum(v: Prisma.Decimal | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return parseFloat(v.toString());
}

/** ISO week label `YYYY-Www` (UTC) for grouping throughput by week. */
function isoWeekLabel(date: Date): string {
  // Copy and normalize to the nearest Thursday (ISO week is defined by it).
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  /**
   * Per-project health roll-up + workspace totals. For each visible project:
   * budgeted vs logged hours, billed/accrued vs budget amount, % complete
   * (tasks done / total), status, and an over-budget flag (hours OR amount).
   */
  async getPortfolio(workspaceId: string, user: User) {
    const projectWhere = this.projectVisibilityWhere(user);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const projects = await tx.project.findMany({
          where: projectWhere,
          select: {
            id: true,
            projectNumber: true,
            title: true,
            status: true,
            clientName: true,
            budgetHours: true,
            budgetAmount: true,
          },
          orderBy: { createdAt: 'desc' },
        });

        if (projects.length === 0) {
          return { projects: [], totals: this.emptyPortfolioTotals(), statusBreakdown: [] };
        }

        const projectIds = projects.map((p) => p.id);
        const [loggedByProject, billedByProject, taskStatsByProject] = await Promise.all([
          this.sumLoggedSeconds(tx, projectIds),
          this.sumBilledAmount(tx, projectIds),
          this.taskCompletion(tx, projectIds),
        ]);

        const rows = projects.map((p) => {
          const budgetHours = decToNum(p.budgetHours);
          const budgetAmount = decToNum(p.budgetAmount);
          const loggedHours = hours(loggedByProject.get(p.id) ?? 0);
          const billedAmount = money(billedByProject.get(p.id) ?? 0);
          const stats = taskStatsByProject.get(p.id) ?? { total: 0, completed: 0 };
          const pctHours = pctOf(loggedHours, budgetHours);
          const pctAmount = pctOf(billedAmount, budgetAmount);
          const percentComplete =
            stats.total > 0 ? Math.round((stats.completed / stats.total) * 1000) / 10 : 0;
          const overBudget =
            (pctHours !== null && pctHours > 100) || (pctAmount !== null && pctAmount > 100);

          return {
            projectId: p.id,
            projectNumber: p.projectNumber,
            title: p.title,
            clientName: p.clientName,
            status: p.status,
            budgetHours,
            loggedHours,
            pctHours,
            budgetAmount,
            billedAmount,
            pctAmount,
            tasksTotal: stats.total,
            tasksCompleted: stats.completed,
            percentComplete,
            overBudget,
          };
        });

        // Statuses that count as "active" (in-flight, not finished/archived).
        const ACTIVE_STATUSES = new Set<ProjectStatus>([
          ProjectStatus.NEW,
          ProjectStatus.IN_PROGRESS,
          ProjectStatus.UNDER_REVIEW,
        ]);
        const totals = {
          projects: rows.length,
          activeProjects: rows.filter((r) => ACTIVE_STATUSES.has(r.status)).length,
          budgetHours: round2(sum(rows.map((r) => r.budgetHours ?? 0))),
          loggedHours: round2(sum(rows.map((r) => r.loggedHours))),
          budgetAmount: round2(sum(rows.map((r) => r.budgetAmount ?? 0))),
          billedAmount: round2(sum(rows.map((r) => r.billedAmount))),
          tasksTotal: sum(rows.map((r) => r.tasksTotal)),
          tasksCompleted: sum(rows.map((r) => r.tasksCompleted)),
          overBudgetCount: rows.filter((r) => r.overBudget).length,
        };

        // Chart-friendly status breakdown (count by status).
        const byStatus = new Map<ProjectStatus, number>();
        for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
        const statusBreakdown: SeriesPoint[] = Array.from(byStatus.entries()).map(
          ([label, value]) => ({ label, value }),
        );

        return { projects: rows, totals, statusBreakdown };
      },
      workspaceId,
    );
  }

  /**
   * Per-project + workspace profitability. Billable amount is the SUM of the
   * stored `billableAmount` on billable entries (already rate-resolved/rounded —
   * never recomputed). Cost basis is `costRateApplied × billable-hours` summed
   * per project. Margin = billable − cost; realization = billed / billable.
   *
   * MANAGER/ADMIN only (enforced at the controller). Cost/margin are internal.
   */
  async getProfitability(workspaceId: string, user: User, period: Period) {
    const isPrivileged = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    const baseWhere = this.timeEntryWhere(user, workspaceId, period);

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // One grouped query for billable value + billable seconds (the priced,
        // billable rows), one for the billed slice (realization numerator).
        const [billableGrouped, billedGrouped, entriesForCost] = await Promise.all([
          tx.timeEntry.groupBy({
            by: ['projectId'],
            where: { ...baseWhere, billable: true },
            _sum: { billableAmount: true, roundingAppliedSeconds: true, durationSeconds: true },
          }),
          tx.timeEntry.groupBy({
            by: ['projectId'],
            where: { ...baseWhere, billable: true, billed: true },
            _sum: { billableAmount: true },
          }),
          // Cost basis can't be aggregated in one groupBy (it's rate × seconds
          // per entry), so pull the minimal columns for billable, priced-cost
          // entries and fold per project. Bounded to the workspace + period.
          isPrivileged
            ? tx.timeEntry.findMany({
                where: { ...baseWhere, billable: true, costRateApplied: { not: null } },
                select: {
                  projectId: true,
                  costRateApplied: true,
                  roundingAppliedSeconds: true,
                  durationSeconds: true,
                },
              })
            : Promise.resolve(
                [] as Array<{
                  projectId: string;
                  costRateApplied: Prisma.Decimal | null;
                  roundingAppliedSeconds: number | null;
                  durationSeconds: number | null;
                }>,
              ),
        ]);

        const billedByProject = new Map(
          billedGrouped.map((g) => [g.projectId, money(g._sum.billableAmount)]),
        );

        const costByProject = new Map<string, Decimal>();
        for (const e of entriesForCost) {
          if (!e.costRateApplied) continue;
          const secs = e.roundingAppliedSeconds ?? e.durationSeconds ?? 0;
          const cost = new Decimal(e.costRateApplied).mul(secs).div(3600);
          costByProject.set(
            e.projectId,
            (costByProject.get(e.projectId) ?? new Decimal(0)).add(cost),
          );
        }

        // Resolve project labels for the projects that appear in the rollup.
        const projectIds = Array.from(new Set(billableGrouped.map((g) => g.projectId)));
        const projects = await tx.project.findMany({
          where: { id: { in: projectIds } },
          select: { id: true, projectNumber: true, title: true, clientName: true },
        });
        const projectById = new Map(projects.map((p) => [p.id, p]));

        const rows = billableGrouped.map((g) => {
          const billableAmount = money(g._sum.billableAmount);
          const billedAmount = billedByProject.get(g.projectId) ?? 0;
          const costBasis = isPrivileged
            ? money(costByProject.get(g.projectId) ?? new Decimal(0))
            : null;
          const margin = costBasis !== null ? round2(billableAmount - costBasis) : null;
          const marginPct =
            costBasis !== null && billableAmount > 0
              ? Math.round((margin! / billableAmount) * 1000) / 10
              : null;
          const realization =
            billableAmount > 0 ? Math.round((billedAmount / billableAmount) * 1000) / 10 : 0;
          const p = projectById.get(g.projectId);
          return {
            projectId: g.projectId,
            projectNumber: p?.projectNumber ?? null,
            title: p?.title ?? null,
            clientName: p?.clientName ?? null,
            billableHours: hours(g._sum.roundingAppliedSeconds ?? g._sum.durationSeconds ?? 0),
            billableAmount,
            billedAmount,
            costBasis,
            margin,
            marginPct,
            realization,
          };
        });

        const totalBillable = round2(sum(rows.map((r) => r.billableAmount)));
        const totalBilled = round2(sum(rows.map((r) => r.billedAmount)));
        const totalCost = isPrivileged ? round2(sum(rows.map((r) => r.costBasis ?? 0))) : null;
        const totalMargin = totalCost !== null ? round2(totalBillable - totalCost) : null;

        const totals = {
          billableHours: round2(sum(rows.map((r) => r.billableHours))),
          billableAmount: totalBillable,
          billedAmount: totalBilled,
          costBasis: totalCost,
          margin: totalMargin,
          marginPct:
            totalMargin !== null && totalBillable > 0
              ? Math.round((totalMargin / totalBillable) * 1000) / 10
              : null,
          realization:
            totalBillable > 0 ? Math.round((totalBilled / totalBillable) * 1000) / 10 : 0,
        };

        return { period, projects: rows, totals };
      },
      workspaceId,
    );
  }

  /**
   * Throughput over a window: tasks + projects COMPLETED, bucketed by ISO week,
   * plus a status breakdown of tasks created in-window. Shaped for charts: each
   * series is an array of {label, value}. Defaults to the trailing 12 weeks when
   * no window is supplied.
   */
  async getThroughput(workspaceId: string, user: User, period: Period) {
    const now = new Date();
    const to = period.to ? new Date(period.to) : now;
    const from = period.from ? new Date(period.from) : new Date(to.getTime() - 12 * 7 * 86400000);

    const taskWhere: Prisma.TaskWhereInput = {
      ...this.taskVisibilityWhere(user),
      status: TaskStatus.COMPLETED,
      completedAt: { gte: from, lte: to },
    };
    const projectWhere: Prisma.ProjectWhereInput = {
      ...this.projectVisibilityWhere(user),
      status: ProjectStatus.COMPLETED,
      completedAt: { gte: from, lte: to },
    };

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [completedTasks, completedProjects, tasksByStatus] = await Promise.all([
          tx.task.findMany({ where: taskWhere, select: { completedAt: true } }),
          tx.project.findMany({ where: projectWhere, select: { completedAt: true } }),
          // Status breakdown for tasks touched (created) in the window.
          tx.task.groupBy({
            by: ['status'],
            where: {
              ...this.taskVisibilityWhere(user),
              createdAt: { gte: from, lte: to },
            },
            _count: { _all: true },
          }),
        ]);

        const tasksPerWeek = this.bucketByWeek(completedTasks.map((t) => t.completedAt));
        const projectsPerWeek = this.bucketByWeek(completedProjects.map((p) => p.completedAt));

        const statusBreakdown: SeriesPoint[] = tasksByStatus.map((s) => ({
          label: s.status,
          value: s._count._all,
        }));

        return {
          period: { from: from.toISOString(), to: to.toISOString() },
          tasksCompleted: {
            total: completedTasks.length,
            series: tasksPerWeek,
          },
          projectsCompleted: {
            total: completedProjects.length,
            series: projectsPerWeek,
          },
          tasksByStatus: statusBreakdown,
        };
      },
      workspaceId,
    );
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Sum logged seconds per project (rounded billable seconds when present). */
  private async sumLoggedSeconds(
    tx: WorkspaceTxClient,
    projectIds: string[],
  ): Promise<Map<string, number>> {
    const grouped = await tx.timeEntry.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds } },
      _sum: { durationSeconds: true, roundingAppliedSeconds: true },
    });
    const out = new Map<string, number>();
    for (const g of grouped) {
      out.set(g.projectId, g._sum.roundingAppliedSeconds ?? g._sum.durationSeconds ?? 0);
    }
    return out;
  }

  /** Sum accrued billable value per project (stored, already-rated amount). */
  private async sumBilledAmount(
    tx: WorkspaceTxClient,
    projectIds: string[],
  ): Promise<Map<string, number>> {
    const grouped = await tx.timeEntry.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, billable: true },
      _sum: { billableAmount: true },
    });
    const out = new Map<string, number>();
    for (const g of grouped) out.set(g.projectId, money(g._sum.billableAmount));
    return out;
  }

  /** Task completion (total + completed) per project in one grouped query. */
  private async taskCompletion(
    tx: WorkspaceTxClient,
    projectIds: string[],
  ): Promise<Map<string, { total: number; completed: number }>> {
    const grouped = await tx.task.groupBy({
      by: ['projectId', 'status'],
      where: { projectId: { in: projectIds } },
      _count: { _all: true },
    });
    const out = new Map<string, { total: number; completed: number }>();
    for (const row of grouped) {
      const cur = out.get(row.projectId) ?? { total: 0, completed: 0 };
      cur.total += row._count._all;
      if (row.status === TaskStatus.COMPLETED) cur.completed += row._count._all;
      out.set(row.projectId, cur);
    }
    return out;
  }

  /** Bucket a list of dates into {label: ISO-week, value: count}, sorted. */
  private bucketByWeek(dates: (Date | null)[]): SeriesPoint[] {
    const byWeek = new Map<string, number>();
    for (const d of dates) {
      if (!d) continue;
      const label = isoWeekLabel(d);
      byWeek.set(label, (byWeek.get(label) ?? 0) + 1);
    }
    return Array.from(byWeek.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Project where-filter for the active user's role (RLS already scopes ws). */
  private projectVisibilityWhere(user: User): Prisma.ProjectWhereInput {
    if (user.role === UserRole.CLIENT) return { contactId: user.id };
    if (user.role === UserRole.STAFF) {
      return { OR: [{ assignedToId: user.id }, { createdById: user.id }] };
    }
    return {};
  }

  /** Task where-filter mirroring project visibility (via the parent project). */
  private taskVisibilityWhere(user: User): Prisma.TaskWhereInput {
    if (user.role === UserRole.CLIENT) {
      return { project: { contactId: user.id } };
    }
    if (user.role === UserRole.STAFF) {
      return {
        OR: [
          { assignedToId: user.id },
          { createdById: user.id },
          { project: { OR: [{ assignedToId: user.id }, { createdById: user.id }] } },
        ],
      };
    }
    return {};
  }

  /** TimeEntry where-filter: role/workspace visibility + completed + period. */
  private timeEntryWhere(
    user: User,
    workspaceId: string,
    period: Period,
  ): Prisma.TimeEntryWhereInput {
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

  private emptyPortfolioTotals() {
    return {
      projects: 0,
      activeProjects: 0,
      budgetHours: 0,
      loggedHours: 0,
      budgetAmount: 0,
      billedAmount: 0,
      tasksTotal: 0,
      tasksCompleted: 0,
      overBudgetCount: 0,
    };
  }
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
