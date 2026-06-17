/**
 * Tailwind tone helpers for Time-Tracking badges. Same opacity-tinted,
 * dark-mode-aware vocabulary as `lib/badge-styles.ts` (the `.vibrant` theme
 * also matches the `dark:` variant via globals.css, so `dark:text-*` covers
 * both dark and vibrant — never use light-only `bg-*-100`).
 */

const ZINC_FALLBACK = 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300';

const APPROVAL_TONE: Record<string, string> = {
  DRAFT: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  SUBMITTED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  APPROVED: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  REJECTED: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

const APPROVAL_DOT: Record<string, string> = {
  DRAFT: 'bg-zinc-400',
  SUBMITTED: 'bg-amber-500',
  APPROVED: 'bg-emerald-500',
  REJECTED: 'bg-rose-500',
};

const SOURCE_TONE: Record<string, string> = {
  TIMER: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  MANUAL: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  IMPORTED: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
};

/** Pill for ApprovalStatus (DRAFT / SUBMITTED / APPROVED / REJECTED). */
export function approvalBadgeClass(status: string): string {
  return APPROVAL_TONE[status] ?? ZINC_FALLBACK;
}

/** Small status dot colour for ApprovalStatus. */
export function approvalDotClass(status: string): string {
  return APPROVAL_DOT[status] ?? 'bg-zinc-400';
}

/** Pill for TimeEntrySource (TIMER / MANUAL / IMPORTED). */
export function sourceBadgeClass(source: string): string {
  return SOURCE_TONE[source] ?? ZINC_FALLBACK;
}

/** Pill for billable/non-billable. */
export function billableBadgeClass(billable: boolean): string {
  return billable
    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
    : 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300';
}

/** Human label for a RateScopeType. */
export const RATE_SCOPE_LABELS: Record<string, string> = {
  TASK: 'Task',
  TASK_TYPE: 'Task type',
  PROJECT: 'Project',
  CONTACT: 'Client / contact',
  USER_PROJECT: 'User on project',
  USER: 'User',
  ROLE: 'Role',
  ORG: 'Organization (default)',
};

/** Title-case an enum-ish token like SUBMITTED → "Submitted". */
export function prettyEnum(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}
