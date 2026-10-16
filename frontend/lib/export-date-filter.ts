import {
  addDateOnlyDays,
  businessDateToday,
  dateOnlyValue,
} from "./date-only.ts";

export type ExportDatePreset = "ALL" | "7D" | "30D" | "90D" | "CUSTOM";
export type ExportDateMode = "instant" | "date-only";
export type ExportDateValue = string | Date | number | null | undefined;

export interface ExportDateWindow {
  from?: Date | string;
  to?: Date | string;
}

/**
 * Return the same rolling windows used by the exporter. Date-only fields use
 * business-calendar keys; instant fields retain the browser-local behavior.
 */
export function exportDateWindow(
  mode: ExportDateMode,
  preset: ExportDatePreset,
  customFrom: string,
  customTo: string,
  now: Date = new Date(),
): ExportDateWindow {
  if (preset === "ALL") return {};

  if (preset === "CUSTOM") {
    if (mode === "date-only") {
      return {
        from: customFrom || undefined,
        to: customTo || undefined,
      };
    }
    return {
      from: customFrom ? new Date(`${customFrom}T00:00:00`) : undefined,
      to: customTo ? new Date(`${customTo}T23:59:59`) : undefined,
    };
  }

  const days = preset === "7D" ? 7 : preset === "30D" ? 30 : 90;
  if (mode === "date-only") {
    const to = businessDateToday(now);
    return { from: addDateOnlyDays(to, -days), to };
  }

  const to = new Date(now);
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from, to };
}

function asDateOnly(value: ExportDateValue): string | null {
  if (typeof value === "number") return dateOnlyValue(new Date(value));
  return dateOnlyValue(value);
}

/** Compare one exported value against an inclusive date window. */
export function matchesExportDateWindow(
  raw: ExportDateValue,
  window: ExportDateWindow,
  mode: ExportDateMode,
): boolean {
  if (!raw) return false;

  if (mode === "date-only") {
    const value = asDateOnly(raw);
    const from = asDateOnly(window.from);
    const to = asDateOnly(window.to);
    if (!value) return false;
    if (from && value < from) return false;
    if (to && value > to) return false;
    return true;
  }

  const time = new Date(raw).getTime();
  if (Number.isNaN(time)) return false;
  if (window.from && time < new Date(window.from).getTime()) return false;
  if (window.to && time > new Date(window.to).getTime()) return false;
  return true;
}
