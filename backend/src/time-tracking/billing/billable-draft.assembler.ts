import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { BillableGroupBy } from '../dto/create-billable-draft.dto';

/**
 * A billable unit, agnostic to where it came from. Today the only producer is
 * time entries; expenses/milestones can be mapped to this same shape later
 * without touching the grouping/invoice logic.
 */
export interface BillableSource {
  id: string; // becomes the invoice line's source_ref
  date: Date;
  description: string;
  quantityHours: Decimal; // hours (for TIME); 1 for fixed-amount sources
  unitRate: Decimal; // hourly bill rate (or the fixed amount when quantity = 1)
  amount: Decimal; // extended, authoritative
  currency: string;
  taskId?: string | null;
  taskTitle?: string | null;
  role?: string | null;
  userId?: string | null;
}

export interface AssembledLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  sourceRefs: string[];
}

export interface AssembledDraft {
  currency: string;
  lineItems: AssembledLine[];
  total: string;
  sourceIds: string[];
  entryCount: number;
}

@Injectable()
export class BillableDraftAssembler {
  /**
   * Group sources into invoice line items. Lines are always segmented by
   * (groupKey, unitRate, currency) so every line has one consistent rate and
   * its amount always reconciles to the sum of its sources.
   */
  assemble(sources: BillableSource[], groupBy: BillableGroupBy = BillableGroupBy.TASK): AssembledDraft {
    if (!sources.length) {
      throw new BadRequestException('No billable items to assemble');
    }

    const currency = sources[0].currency || 'USD';
    if (sources.some((s) => (s.currency || 'USD') !== currency)) {
      throw new BadRequestException(
        'Cannot assemble a single invoice across multiple currencies; scope the rollup to one currency.',
      );
    }

    const groups = new Map<
      string,
      { label: string; rate: Decimal; quantity: Decimal; amount: Decimal; refs: string[] }
    >();

    for (const s of sources) {
      const { key, label } = this.groupKey(s, groupBy);
      const rateKey = `${key}|${s.unitRate.toString()}`;
      const existing = groups.get(rateKey);
      if (existing) {
        existing.quantity = existing.quantity.add(s.quantityHours);
        existing.amount = existing.amount.add(s.amount);
        existing.refs.push(s.id);
      } else {
        groups.set(rateKey, {
          label,
          rate: s.unitRate,
          quantity: s.quantityHours,
          amount: s.amount,
          refs: [s.id],
        });
      }
    }

    const lineItems: AssembledLine[] = [];
    let total = new Decimal(0);
    for (const g of groups.values()) {
      const amount = g.amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      total = total.add(amount);
      lineItems.push({
        description: g.label,
        quantity: g.quantity.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
        unitPrice: g.rate.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toString(),
        amount: amount.toString(),
        sourceRefs: g.refs,
      });
    }

    // Deterministic ordering so the same inputs always produce the same draft.
    lineItems.sort((a, b) => a.description.localeCompare(b.description));

    return {
      currency,
      lineItems,
      total: total.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toString(),
      sourceIds: sources.map((s) => s.id),
      entryCount: sources.length,
    };
  }

  private groupKey(s: BillableSource, groupBy: BillableGroupBy): { key: string; label: string } {
    switch (groupBy) {
      case BillableGroupBy.NONE:
        return { key: s.id, label: s.description || 'Work' };
      case BillableGroupBy.DAY: {
        const day = s.date.toISOString().slice(0, 10);
        return { key: `day:${day}`, label: `Work on ${day}` };
      }
      case BillableGroupBy.ROLE: {
        const role = s.role || 'Staff';
        return { key: `role:${role}`, label: `${role} — professional services` };
      }
      case BillableGroupBy.TASK:
      default: {
        const taskId = s.taskId || 'untasked';
        const label = s.taskTitle || (s.taskId ? 'Task work' : 'Project work');
        return { key: `task:${taskId}`, label };
      }
    }
  }
}
