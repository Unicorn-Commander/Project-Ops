import { UserRole } from '@prisma/client';
import { redactCost } from '../common/workspace/time-entry-visibility';

/** Prisma Decimal | null -> number | null (house pattern). */
export function decToNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  return parseFloat(v.toString());
}

/**
 * Shape a TimeEntry for the wire: convert Decimal money fields to numbers and
 * redact cost/margin for CLIENT viewers. Safe on hydrated (include) entries.
 */
export function serializeTimeEntry(entry: any, role: UserRole): any {
  if (!entry) return entry;
  const out = {
    ...entry,
    billRateApplied: decToNum(entry.billRateApplied),
    costRateApplied: decToNum(entry.costRateApplied),
    billableAmount: decToNum(entry.billableAmount),
  };
  return redactCost(out, role);
}

export function serializeTimeEntries(entries: any[], role: UserRole): any[] {
  return (entries || []).map((e) => serializeTimeEntry(e, role));
}
