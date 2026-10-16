/** Date-only values are calendar dates, never browser-local instants. */
export const BUSINESS_TIME_ZONE = "America/New_York";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function validDateOnly(value: string): string | null {
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
    return null;
  }
  return value;
}

function partsToDateOnly(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function businessParts(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return { year: values.year, month: values.month, day: values.day };
}

/** Convert an API date-only value (including the legacy UTC-midnight ISO form) to YYYY-MM-DD. */
export function dateOnlyValue(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const raw = validDateOnly(value);
    if (raw) return raw;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // Ordinary date-only fields use the existing UTC-midnight storage convention.
  if (
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  ) {
    return partsToDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }

  // Recurrence-generated values are real instants; derive their calendar date
  // in the named business zone instead of the browser's local zone.
  const parts = businessParts(date);
  return partsToDateOnly(parts.year, parts.month, parts.day);
}

/** Format a date-only API value without parsing YYYY-MM-DD as a UTC instant in the browser. */
export function formatDateOnly(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" },
): string {
  const raw = dateOnlyValue(value);
  if (!raw) return "";
  const [year, month, day] = raw.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  );
}

/** Make a Date-fns-compatible local calendar date from a date-only value. */
export function dateOnlyToCalendarDate(value: string | Date): Date {
  const raw = dateOnlyValue(value);
  if (!raw) throw new RangeError("Invalid date-only value");
  const [year, month, day] = raw.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Read a local calendar Date (for example a drag target) as YYYY-MM-DD. */
export function localDateToDateOnly(value: Date): string {
  return partsToDateOnly(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

/** The current calendar date in the business zone. */
export function businessDateToday(now: Date = new Date()): string {
  const parts = businessParts(now);
  return partsToDateOnly(parts.year, parts.month, parts.day);
}

export function addDateOnlyDays(value: string, days: number): string {
  const raw = validDateOnly(value);
  if (!raw) throw new RangeError("Invalid date-only value");
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return partsToDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function isDateOnlyBeforeToday(value: string | Date, now: Date = new Date()): boolean {
  const raw = dateOnlyValue(value);
  return raw !== null && raw < businessDateToday(now);
}

export function dateOnlyDaysFromToday(value: string | Date, now: Date = new Date()): number {
  const raw = dateOnlyValue(value);
  if (!raw) return 0;
  const [year, month, day] = raw.split("-").map(Number);
  const today = businessDateToday(now).split("-").map(Number);
  return Math.round(
    (Date.UTC(year, month - 1, day) - Date.UTC(today[0], today[1] - 1, today[2])) / MS_PER_DAY,
  );
}
