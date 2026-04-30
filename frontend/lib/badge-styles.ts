/**
 * Centralised Tailwind class helpers for status/priority badges.
 *
 * The previous inline maps used `bg-blue-100 text-blue-800` style classes
 * which only render correctly in light mode — in dark mode the pastel
 * background and dark-on-pastel text both look out of place against the
 * dark cards. These helpers use opacity-tinted backgrounds plus dark-mode
 * aware text so the same badge reads cleanly in either theme.
 */

export type ProjectStatus =
  | "NEW"
  | "IN_PROGRESS"
  | "UNDER_REVIEW"
  | "COMPLETED"
  | "ARCHIVED"
  | "ON_HOLD";

export type TaskStatusKey =
  | "PENDING"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "UNDER_REVIEW"
  | "COMPLETED"
  | "CANCELLED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

const STATUS_TONE: Record<string, string> = {
  NEW:           "bg-blue-500/15    text-blue-700    dark:text-blue-300",
  IN_PROGRESS:   "bg-amber-500/15   text-amber-700   dark:text-amber-300",
  UNDER_REVIEW:  "bg-violet-500/15  text-violet-700  dark:text-violet-300",
  COMPLETED:     "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ON_HOLD:       "bg-orange-500/15  text-orange-700  dark:text-orange-300",
  ARCHIVED:      "bg-zinc-500/15    text-zinc-700    dark:text-zinc-300",
  PENDING:             "bg-blue-500/15   text-blue-700   dark:text-blue-300",
  BLOCKED:             "bg-rose-500/15   text-rose-700   dark:text-rose-300",
  CANCELLED:           "bg-zinc-500/15   text-zinc-700   dark:text-zinc-300",
  WAITING_FOR_CLIENT:  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};

const PRIORITY_TONE: Record<string, string> = {
  LOW:    "text-zinc-500   dark:text-zinc-400",
  MEDIUM: "text-blue-600   dark:text-blue-400",
  HIGH:   "text-orange-600 dark:text-orange-400",
  URGENT: "text-rose-600   dark:text-rose-400",
};

const PAYMENT_STATUS_TONE: Record<string, string> = {
  UNPAID:         "bg-rose-500/15    text-rose-700    dark:text-rose-300",
  PARTIALLY_PAID: "bg-amber-500/15   text-amber-700   dark:text-amber-300",
  PAID:           "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  OVERDUE:        "bg-rose-600/25    text-rose-800    dark:text-rose-200",
  CANCELLED:      "bg-zinc-500/15    text-zinc-700    dark:text-zinc-300",
};

const PRIORITY_BADGE_TONE: Record<string, string> = {
  LOW:    "bg-zinc-500/15   text-zinc-700   dark:text-zinc-300",
  MEDIUM: "bg-blue-500/15   text-blue-700   dark:text-blue-300",
  HIGH:   "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  URGENT: "bg-rose-500/15   text-rose-700   dark:text-rose-300",
};

const ICON_TONE: Record<string, string> = {
  blue:    "bg-blue-500/15    text-blue-600    dark:text-blue-300",
  amber:   "bg-amber-500/15   text-amber-600   dark:text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  rose:    "bg-rose-500/15    text-rose-600    dark:text-rose-300",
  violet:  "bg-violet-500/15  text-violet-600  dark:text-violet-300",
  orange:  "bg-orange-500/15  text-orange-600  dark:text-orange-300",
  zinc:    "bg-zinc-500/15    text-zinc-600    dark:text-zinc-300",
  primary: "bg-primary/15     text-primary",
};

const ZINC_FALLBACK = "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";

/**
 * Pill style for ProjectStatus / TaskStatus values. Returns a class string
 * suitable for `<span className={...}>STATUS</span>`.
 */
export function statusBadgeClass(status: string): string {
  return STATUS_TONE[status] ?? ZINC_FALLBACK;
}

/**
 * Plain text colour for priority labels (no background). Use when you want
 * just a tinted word, e.g. dashboard recent-projects "Priority: HIGH".
 */
export function priorityTextClass(priority: string): string {
  return PRIORITY_TONE[priority] ?? PRIORITY_TONE.LOW;
}

/**
 * Pill style for priority labels (background + text). Use where priority
 * appears as a chip rather than a bare word.
 */
export function priorityBadgeClass(priority: string): string {
  return PRIORITY_BADGE_TONE[priority] ?? ZINC_FALLBACK;
}

/**
 * Pill style for PaymentStatus enum (UNPAID / PARTIALLY_PAID / PAID / OVERDUE / CANCELLED).
 */
export function paymentStatusBadgeClass(status: string): string {
  return PAYMENT_STATUS_TONE[status] ?? ZINC_FALLBACK;
}

/**
 * Themed icon container — replaces the old `bg-blue-100` style icon wells
 * that were unreadable in dark mode. Pass a tone name (e.g. `"emerald"`)
 * matching the icon's semantic colour.
 */
export function iconWellClass(tone: keyof typeof ICON_TONE): string {
  return ICON_TONE[tone] ?? ICON_TONE.primary;
}
