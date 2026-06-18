/**
 * Minimal RRULE handling for recurring projects (Wave 2).
 *
 * Deliberately mirrors the tasks-side util (../tasks/recurrence.util.ts) — same
 * subset, same function shapes — so the two recurrence engines read identically.
 * It lives here (not shared-imported) because file ownership keeps each feature's
 * helpers in its own module.
 *
 * We support a small subset of RFC-5545 RRULE — enough for the project templates
 * the product exposes (daily / weekly / monthly cadence with an optional
 * INTERVAL) — WITHOUT taking an npm dependency:
 *
 *   FREQ=DAILY|WEEKLY|MONTHLY     (required)
 *   INTERVAL=<positive integer>   (optional, default 1)
 *
 * Other RRULE parts (COUNT, UNTIL, BYDAY, …) are intentionally ignored: an
 * unrecognized part never throws, it is simply skipped, so a richer rule still
 * yields a sane cadence. An unparseable/empty rule or an unsupported FREQ
 * returns null, and the caller treats that template as non-spawning.
 */

export type RecurrenceFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ParsedRecurrence {
  freq: RecurrenceFreq;
  interval: number;
}

const SUPPORTED_FREQ: ReadonlySet<string> = new Set(['DAILY', 'WEEKLY', 'MONTHLY']);

/**
 * Parse an RRULE string into { freq, interval }. Case-insensitive on keys, and
 * tolerant of a leading `RRULE:` prefix and surrounding whitespace. Returns null
 * when there is no usable FREQ or the FREQ is unsupported.
 */
export function parseRecurrenceRule(rule: string | null | undefined): ParsedRecurrence | null {
  if (!rule || !rule.trim()) {
    return null;
  }

  // Allow an optional "RRULE:" prefix (RFC content line) before the parts.
  const body = rule.trim().replace(/^RRULE:/i, '');

  let freq: RecurrenceFreq | null = null;
  let interval = 1;

  for (const part of body.split(';')) {
    const [rawKey, rawValue] = part.split('=');
    if (!rawKey || rawValue === undefined) {
      continue;
    }
    const key = rawKey.trim().toUpperCase();
    const value = rawValue.trim().toUpperCase();

    if (key === 'FREQ') {
      if (SUPPORTED_FREQ.has(value)) {
        freq = value as RecurrenceFreq;
      } else {
        // Unsupported frequency (e.g. YEARLY, HOURLY) → no cadence we model.
        return null;
      }
    } else if (key === 'INTERVAL') {
      const parsed = parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        interval = parsed;
      }
      // A malformed interval falls back to the default of 1.
    }
    // Any other part is ignored on purpose.
  }

  if (!freq) {
    return null;
  }

  return { freq, interval };
}

/**
 * Advance `from` by one recurrence step, preserving the time-of-day. MONTHLY
 * arithmetic clamps to the last valid day of the target month (e.g. Jan 31 +1mo
 * → Feb 28/29) instead of overflowing into the following month, which is the
 * least-surprising behavior for a due date.
 */
export function advanceByRecurrence(from: Date, parsed: ParsedRecurrence): Date {
  const next = new Date(from.getTime());

  switch (parsed.freq) {
    case 'DAILY':
      next.setUTCDate(next.getUTCDate() + parsed.interval);
      return next;
    case 'WEEKLY':
      next.setUTCDate(next.getUTCDate() + 7 * parsed.interval);
      return next;
    case 'MONTHLY': {
      const day = from.getUTCDate();
      // Move to the first of the month first so adding months never rolls over
      // (e.g. Mar 31 + 1mo would otherwise skip to May 1). Then clamp the day.
      next.setUTCDate(1);
      next.setUTCMonth(next.getUTCMonth() + parsed.interval);
      const lastDayOfTargetMonth = new Date(
        Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0),
      ).getUTCDate();
      next.setUTCDate(Math.min(day, lastDayOfTargetMonth));
      return next;
    }
  }
}

/**
 * Compute the next occurrence STRICTLY AFTER `after`, starting the cadence at
 * `anchor` (the template's own dueDate, or its createdAt when it has none).
 * Walks forward from the anchor in cadence steps until past `after`. A safety
 * cap bounds the walk for a far-in-the-past anchor with a tiny interval.
 *
 * Returns null when the rule is unusable.
 */
export function nextOccurrenceAfter(
  rule: string | null | undefined,
  anchor: Date,
  after: Date,
): Date | null {
  const parsed = parseRecurrenceRule(rule);
  if (!parsed) {
    return null;
  }

  // If the anchor itself is already after the cursor, that's the next occurrence.
  if (anchor.getTime() > after.getTime()) {
    return anchor;
  }

  let candidate = anchor;
  // Cap iterations to avoid pathological walks (e.g. a years-old DAILY anchor).
  const MAX_STEPS = 4000;
  for (let i = 0; i < MAX_STEPS; i++) {
    candidate = advanceByRecurrence(candidate, parsed);
    if (candidate.getTime() > after.getTime()) {
      return candidate;
    }
  }
  return candidate;
}
