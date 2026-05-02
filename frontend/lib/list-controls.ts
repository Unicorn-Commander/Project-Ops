/**
 * Generic helpers for list pages: sort comparator factory + date-range
 * predicate. The components in `components/ui/list-toolbar.tsx` consume
 * these so every list page (Projects, Tasks, Contacts, Orgs, Documents,
 * Users) gets the same UX without each one re-implementing the wheel.
 */

export type SortDirection = "asc" | "desc";

export interface SortOption<T extends string = string> {
  value: T;
  label: string;
  direction: SortDirection;
  /** Pretty short caption shown in the trigger when this sort is active. */
  short?: string;
}

/**
 * Compare two values that may be null / undefined / dates / strings /
 * numbers. Nulls always sort to the end regardless of direction (so
 * "no due date" never floats to the top in a Due Date sort).
 */
export function compareValues(
  a: unknown,
  b: unknown,
  direction: SortDirection = "asc",
): number {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil && bNil) return 0;
  if (aNil) return 1;
  if (bNil) return -1;

  const sign = direction === "asc" ? 1 : -1;

  // Date strings: ISO comparable already; normalise via Date for safety.
  if (typeof a === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a)) {
    const av = new Date(a as string).getTime();
    const bv = new Date(b as string).getTime();
    return (av - bv) * sign;
  }
  if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) * sign;
  }
  return 0;
}

/**
 * Priority enum ordering (URGENT > HIGH > MEDIUM > LOW). Used by both
 * project + task sorters.
 */
const PRIORITY_RANK: Record<string, number> = {
  URGENT: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return 0;
  return PRIORITY_RANK[priority] ?? 0;
}

/**
 * Status ordering — earlier-stage statuses sort first when ascending.
 * Tweak as the workflow shifts.
 */
const STATUS_RANK: Record<string, number> = {
  NEW: 1,
  PENDING_APPROVAL: 2,
  IN_PROGRESS: 3,
  UNDER_REVIEW: 4,
  ON_HOLD: 5,
  COMPLETED: 6,
  CANCELLED: 7,
};

export function statusRank(status: string | null | undefined): number {
  if (!status) return 0;
  return STATUS_RANK[status] ?? 99;
}

/**
 * Date-range presets shown in the date filter dropdown.
 */
export type DateRangePreset =
  | "ALL"
  | "TODAY"
  | "WEEK"
  | "MONTH"
  | "QUARTER"
  | "YEAR";

export const DATE_RANGE_OPTIONS: { value: DateRangePreset; label: string }[] = [
  { value: "ALL", label: "All time" },
  { value: "TODAY", label: "Today" },
  { value: "WEEK", label: "Last 7 days" },
  { value: "MONTH", label: "Last 30 days" },
  { value: "QUARTER", label: "Last 90 days" },
  { value: "YEAR", label: "Last 365 days" },
];

/**
 * Returns true if the supplied ISO date string falls within the named
 * preset window (inclusive). Anything outside the window — or a missing
 * date — returns false (which is what filter callers usually want).
 */
export function withinDateRange(
  iso: string | null | undefined,
  range: DateRangePreset,
): boolean {
  if (range === "ALL") return true;
  if (!iso) return false;
  const dateMs = new Date(iso).getTime();
  if (Number.isNaN(dateMs)) return false;

  const now = Date.now();
  const dayMs = 86_400_000;
  const cutoff = (() => {
    switch (range) {
      case "TODAY":
        return now - dayMs;
      case "WEEK":
        return now - 7 * dayMs;
      case "MONTH":
        return now - 30 * dayMs;
      case "QUARTER":
        return now - 90 * dayMs;
      case "YEAR":
        return now - 365 * dayMs;
    }
  })();
  return dateMs >= cutoff;
}
