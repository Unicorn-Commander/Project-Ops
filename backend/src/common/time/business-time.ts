/**
 * Business-calendar helpers for Project-Ops.
 *
 * The database and process remain UTC. This module is the only place that
 * names the business zone or converts a calendar boundary to a UTC instant.
 * Ordinary date-only values continue to use the existing UTC-midnight storage
 * convention; callers must use formatStoredDateOnly rather than formatting
 * those values in a viewer's local timezone.
 */

export const BUSINESS_TIME_ZONE = 'America/New_York';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_ONLY_FIELDS = new Set([
  'dueDate',
  'billingDate',
  'paymentDueDate',
  'paymentReceivedDate',
]);

export type WallTimeFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface BusinessDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export interface InclusiveUtcBounds {
  from: Date;
  to: Date;
}

const BUSINESS_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  calendar: 'gregory',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function datePartsFromString(value: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY_RE.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date-only value: ${value}`);
  }
  return { year, month, day };
}

function datePartsToString(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function dateTimePartsFromFormatter(date: Date): BusinessDateTimeParts {
  const values: Record<string, number> = {};
  for (const part of BUSINESS_PARTS_FORMATTER.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour === 24 ? 0 : values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: date.getMilliseconds(),
  };
}

/** Return the New York calendar date containing an instant. */
export function businessDateForInstant(date: Date): string {
  const parts = dateTimePartsFromFormatter(date);
  return datePartsToString(parts);
}

/** Parse a date-only input using the existing UTC-midnight storage convention. */
export function dateOnlyToUtcDate(value: string): Date {
  const parts = datePartsFromString(value);
  if (parts) return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`Invalid date value: ${value}`);
  return parsed;
}

/** Alias used at write boundaries that accept either a date-only or ISO value. */
export function coerceDateOnly(value: string): Date {
  return dateOnlyToUtcDate(value);
}

/** Parse an API calendar anchor: a bare date starts at midnight in New York. */
export function parseBusinessDateInput(value: string): Date {
  if (DATE_ONLY_RE.test(value)) return businessDateStartUtc(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError(`Invalid date value: ${value}`);
  return parsed;
}

/** Format a stored date-only value without allowing the viewer timezone to shift it. */
export function formatStoredDateOnly(value: Date | string): string {
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    datePartsFromString(value);
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError('Invalid date value');
  return datePartsToString({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

/** Add calendar days to a YYYY-MM-DD business date. */
export function addCalendarDays(dateOnly: string, days: number): string {
  const parts = datePartsFromString(dateOnly);
  if (!parts) throw new RangeError(`Expected YYYY-MM-DD, got: ${dateOnly}`);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + days);
  return datePartsToString({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function timeZoneOffsetMilliseconds(date: Date): number {
  const parts = dateTimePartsFromFormatter(date);
  const wholeSecond = date.getTime() - date.getMilliseconds();
  return (
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) -
    wholeSecond
  );
}

/** Convert a New York wall-clock value to its UTC instant, including DST. */
export function zonedTimeToUtc(parts: BusinessDateTimeParts): Date {
  const wallClockMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  let candidateMs = wallClockMs;
  // Two iterations are enough for a normal offset change; the extra pass also
  // handles a candidate that crosses the DST boundary during the first pass.
  for (let i = 0; i < 4; i++) {
    candidateMs = wallClockMs - timeZoneOffsetMilliseconds(new Date(candidateMs));
  }
  return new Date(candidateMs);
}

/** Start of a named New York calendar date as a UTC instant. */
export function businessDateStartUtc(dateOnly: string): Date {
  const parts = datePartsFromString(dateOnly);
  if (!parts) throw new RangeError(`Expected YYYY-MM-DD, got: ${dateOnly}`);
  return zonedTimeToUtc({ ...parts, hour: 0, minute: 0, second: 0, millisecond: 0 });
}

/** Inclusive end of a named New York calendar date as a UTC instant. */
export function businessDateEndUtc(dateOnly: string): Date {
  return new Date(businessDateStartUtc(addCalendarDays(dateOnly, 1)).getTime() - 1);
}

/** Current business week, Monday through Sunday, represented by UTC instants. */
export function businessWeekBoundsUtc(now: Date, weekStartDay: number = 1): InclusiveUtcBounds {
  if (!Number.isInteger(weekStartDay) || weekStartDay < 0 || weekStartDay > 6) {
    throw new RangeError(`Invalid week start day: ${weekStartDay}`);
  }
  const currentDate = businessDateForInstant(now);
  const currentParts = datePartsFromString(currentDate)!;
  const currentDay = new Date(
    Date.UTC(currentParts.year, currentParts.month - 1, currentParts.day),
  ).getUTCDay();
  const daysSinceStart = (currentDay - weekStartDay + 7) % 7;
  const startDate = addCalendarDays(currentDate, -daysSinceStart);
  return {
    from: businessDateStartUtc(startDate),
    to: businessDateEndUtc(addCalendarDays(startDate, 6)),
  };
}

/** Inclusive UTC bounds for a 1-based New York calendar month. */
export function businessMonthBoundsUtc(year: number, month: number): InclusiveUtcBounds {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid business month: ${year}-${month}`);
  }
  const startDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const nextDate = datePartsToString({
    year: nextMonth.getUTCFullYear(),
    month: nextMonth.getUTCMonth() + 1,
    day: nextMonth.getUTCDate(),
  });
  return {
    from: businessDateStartUtc(startDate),
    to: new Date(businessDateStartUtc(nextDate).getTime() - 1),
  };
}

/**
 * Date-only rows are stored at UTC midnight. The cutoff is therefore the UTC
 * midnight representation of today's business date, not New York midnight.
 * A query `dueDate < overdueDateCutoffUtc(now)` starts overdue on the next
 * New York calendar day.
 */
export function overdueDateCutoffUtc(now: Date): Date {
  return dateOnlyToUtcDate(businessDateForInstant(now));
}

/** Inclusive calendar-day count for a UTC window viewed in the business zone. */
export function businessCalendarDaysInclusive(window: InclusiveUtcBounds): number {
  const from = datePartsFromString(businessDateForInstant(window.from))!;
  const to = datePartsFromString(businessDateForInstant(window.to))!;
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  return Math.max(1, Math.floor((toMs - fromMs) / MS_PER_DAY) + 1);
}

/** Advance a recurring occurrence in New York wall-clock time. */
export function advanceBusinessWallTime(
  from: Date,
  frequency: WallTimeFrequency,
  interval: number,
): Date {
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new RangeError(`Invalid recurrence interval: ${interval}`);
  }
  // A UTC-midnight value is the established representation of a date-only
  // due date. Keep that representation as a calendar date; it has no wall
  // clock to shift across DST. Timeful recurrence instants take the branch
  // below and preserve their New York wall time instead.
  if (isUtcMidnight(from)) {
    const target = new Date(from.getTime());
    if (frequency === 'DAILY') {
      target.setUTCDate(target.getUTCDate() + interval);
    } else if (frequency === 'WEEKLY') {
      target.setUTCDate(target.getUTCDate() + interval * 7);
    } else {
      const originalDay = target.getUTCDate();
      target.setUTCDate(1);
      target.setUTCMonth(target.getUTCMonth() + interval);
      const lastDay = new Date(
        Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
      ).getUTCDate();
      target.setUTCDate(Math.min(originalDay, lastDay));
    }
    return target;
  }

  const local = dateTimePartsFromFormatter(from);
  const target = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      local.millisecond,
    ),
  );

  if (frequency === 'DAILY') {
    target.setUTCDate(target.getUTCDate() + interval);
  } else if (frequency === 'WEEKLY') {
    target.setUTCDate(target.getUTCDate() + interval * 7);
  } else {
    const originalDay = target.getUTCDate();
    target.setUTCDate(1);
    target.setUTCMonth(target.getUTCMonth() + interval);
    const lastDay = new Date(
      Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
    ).getUTCDate();
    target.setUTCDate(Math.min(originalDay, lastDay));
  }

  return zonedTimeToUtc({
    year: target.getUTCFullYear(),
    month: target.getUTCMonth() + 1,
    day: target.getUTCDate(),
    hour: target.getUTCHours(),
    minute: target.getUTCMinutes(),
    second: target.getUTCSeconds(),
    millisecond: target.getUTCMilliseconds(),
  });
}

function isUtcMidnight(value: Date): boolean {
  return (
    value.getUTCHours() === 0 &&
    value.getUTCMinutes() === 0 &&
    value.getUTCSeconds() === 0 &&
    value.getUTCMilliseconds() === 0
  );
}

function formatApiDateOnly(value: Date | string): string {
  if (typeof value === 'string' && DATE_ONLY_RE.test(value)) {
    return formatStoredDateOnly(value);
  }
  const date = value instanceof Date ? value : new Date(value);
  return isUtcMidnight(date) ? formatStoredDateOnly(date) : businessDateForInstant(date);
}

/** Serialize date-only fields for agent/MCP responses without viewer-timezone shifts. */
export function serializeDateOnlyFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => serializeDateOnlyFields(item)) as T;
  }
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      DATE_ONLY_FIELDS.has(key) &&
      child !== null &&
      (child instanceof Date || typeof child === 'string')
    ) {
      output[key] = formatApiDateOnly(child);
    } else {
      output[key] = serializeDateOnlyFields(child);
    }
  }
  return output as T;
}
