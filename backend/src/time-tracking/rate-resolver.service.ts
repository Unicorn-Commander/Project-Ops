import { Injectable } from '@nestjs/common';
import { Prisma, TaskType, UserRole, BillingRate } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';

export interface RateResolutionInput {
  workspaceId: string;
  date: Date;
  userId?: string | null;
  role?: UserRole | null;
  projectId?: string | null;
  taskId?: string | null;
  taskType?: TaskType | null;
  contactId?: string | null;
  organizationId?: string | null;
  // Inline overrides read off the Task / Project by the caller.
  taskBillRate?: Prisma.Decimal | number | string | null;
  projectDefaultBillRate?: Prisma.Decimal | number | string | null;
  currency?: string | null;
}

export interface ResolvedRate {
  billRate: Decimal | null;
  costRate: Decimal | null;
  currency: string;
  // Where the bill rate came from — useful for audit/debug, never shown to CLIENT.
  source: string;
}

// Precedence rank for a BillingRate row (lower = more specific). The inline
// Task.billRate override is rank 0 and Project.defaultBillRate is rank 4 —
// interleaved with the rate-row scopes per the spec:
//   Task override > TASK > TASK_TYPE > PROJECT > Project.defaultBillRate >
//   CONTACT > USER_PROJECT > USER > ROLE > ORG(specific) > ORG(global)
const SCOPE_RANK: Record<string, number> = {
  TASK: 1,
  TASK_TYPE: 2,
  PROJECT: 3,
  CONTACT: 5,
  USER_PROJECT: 6,
  USER: 7,
  ROLE: 8,
};

function rowRank(row: BillingRate): number {
  if (row.scopeType === 'ORG') return row.organizationId ? 9 : 10;
  return SCOPE_RANK[row.scopeType] ?? 99;
}

function toDecimal(v: Prisma.Decimal | number | string | null | undefined): Decimal | null {
  if (v === null || v === undefined || v === '') return null;
  return new Decimal(v as any);
}

@Injectable()
export class RateResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the most-specific effective bill + cost rate for the given
   * (user, project, task, date). costRate drives margin reporting only and
   * must never be surfaced to a CLIENT.
   *
   * Runs on the caller's workspace `tx` (SUITE-IDENTITY §6): the BillingRate
   * read MUST share the same RLS transaction as the entry being priced, so it
   * is scoped to the active workspace under live RLS. Never opens its own tx.
   */
  async resolve(tx: WorkspaceTxClient, input: RateResolutionInput): Promise<ResolvedRate> {
    const defaultCurrency = input.currency || 'USD';
    const rows = await this.findCandidateRows(tx, input);

    // Best (lowest-rank) rate row for the bill rate; ties broken by the most
    // recent effectiveFrom so newer rates win.
    const ranked = [...rows].sort((a, b) => {
      const r = rowRank(a) - rowRank(b);
      if (r !== 0) return r;
      return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
    });

    const bestRateRow = ranked[0];
    // Cost is resolved independently: the most-specific row that actually
    // carries a costRate (an inline override never carries cost).
    const bestCostRow = ranked.find((r) => r.costRate !== null);

    // Build the bill-rate precedence candidates.
    const taskOverride = toDecimal(input.taskBillRate ?? null);
    const projectDefault = toDecimal(input.projectDefaultBillRate ?? null);

    type Candidate = { rank: number; rate: Decimal; currency: string; source: string };
    const candidates: Candidate[] = [];
    if (taskOverride) {
      candidates.push({
        rank: 0,
        rate: taskOverride,
        currency: defaultCurrency,
        source: 'TASK_OVERRIDE',
      });
    }
    if (projectDefault) {
      candidates.push({
        rank: 4,
        rate: projectDefault,
        currency: defaultCurrency,
        source: 'PROJECT_DEFAULT',
      });
    }
    if (bestRateRow) {
      candidates.push({
        rank: rowRank(bestRateRow),
        rate: new Decimal(bestRateRow.billRate),
        currency: bestRateRow.currency,
        source: `RATE_${bestRateRow.scopeType}`,
      });
    }

    candidates.sort((a, b) => a.rank - b.rank);
    const chosen = candidates[0];

    return {
      billRate: chosen ? chosen.rate : null,
      costRate: bestCostRow ? new Decimal(bestCostRow.costRate as Prisma.Decimal) : null,
      currency: chosen ? chosen.currency : defaultCurrency,
      source: chosen ? chosen.source : 'NONE',
    };
  }

  private async findCandidateRows(
    tx: WorkspaceTxClient,
    input: RateResolutionInput,
  ): Promise<BillingRate[]> {
    const scopeMatches: Prisma.BillingRateWhereInput[] = [];
    if (input.taskId) scopeMatches.push({ scopeType: 'TASK', taskId: input.taskId });
    if (input.taskType) scopeMatches.push({ scopeType: 'TASK_TYPE', taskType: input.taskType });
    if (input.projectId) scopeMatches.push({ scopeType: 'PROJECT', projectId: input.projectId });
    if (input.contactId) scopeMatches.push({ scopeType: 'CONTACT', contactId: input.contactId });
    if (input.userId && input.projectId) {
      scopeMatches.push({
        scopeType: 'USER_PROJECT',
        userId: input.userId,
        projectId: input.projectId,
      });
    }
    if (input.userId) scopeMatches.push({ scopeType: 'USER', userId: input.userId });
    if (input.role) scopeMatches.push({ scopeType: 'ROLE', role: input.role });
    if (input.organizationId)
      scopeMatches.push({ scopeType: 'ORG', organizationId: input.organizationId });
    // Workspace-wide default rate (ORG scope with no org set).
    scopeMatches.push({ scopeType: 'ORG', organizationId: null });

    if (scopeMatches.length === 0) return [];

    return tx.billingRate.findMany({
      where: {
        workspaceId: input.workspaceId,
        effectiveFrom: { lte: input.date },
        AND: [
          { OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.date } }] },
          { OR: scopeMatches },
        ],
      },
    });
  }
}
