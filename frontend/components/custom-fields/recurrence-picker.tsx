"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * RecurrencePicker — a friendly builder for the backend's RRULE subset.
 *
 * The backend accepts a small slice of RFC-5545 RRULE on tasks/projects:
 *   FREQ=DAILY|WEEKLY|MONTHLY  with an optional  INTERVAL=N
 * When set, the task/project becomes a recurrence TEMPLATE and a daily cron
 * materializes its next instance. We deliberately model only FREQ + INTERVAL
 * (no BYDAY/COUNT/UNTIL) so the UI exactly matches what the server honors.
 *
 * Value contract: the empty string means "Does not repeat" (no recurrence).
 * Otherwise it's a normalized rule string like `FREQ=WEEKLY;INTERVAL=2`. The
 * INTERVAL clause is omitted when it would be 1 (so weekly => `FREQ=WEEKLY`),
 * matching the canonical RRULE form.
 */

export type RecurrenceFreq = "DAILY" | "WEEKLY" | "MONTHLY";

const FREQ_OPTIONS: { value: RecurrenceFreq | "NONE"; label: string }[] = [
  { value: "NONE", label: "Does not repeat" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

// The noun shown after the interval ("every N days/weeks/months"), pluralized.
const UNIT_NOUN: Record<RecurrenceFreq, [singular: string, plural: string]> = {
  DAILY: ["day", "days"],
  WEEKLY: ["week", "weeks"],
  MONTHLY: ["month", "months"],
};

/**
 * Parse the supported RRULE subset into { freq, interval }. Tolerant: unknown
 * or malformed input yields `freq: null` (treated as "does not repeat"), and a
 * missing/invalid INTERVAL defaults to 1. Clause order is irrelevant.
 */
export function parseRecurrenceRule(rule?: string | null): {
  freq: RecurrenceFreq | null;
  interval: number;
} {
  if (!rule || !rule.trim()) return { freq: null, interval: 1 };

  const parts = rule.trim().toUpperCase().split(";");
  let freq: RecurrenceFreq | null = null;
  let interval = 1;

  for (const part of parts) {
    const [rawKey, rawVal] = part.split("=");
    const key = rawKey?.trim();
    const val = rawVal?.trim();
    if (!key || !val) continue;
    if (key === "FREQ") {
      if (val === "DAILY" || val === "WEEKLY" || val === "MONTHLY") {
        freq = val;
      }
    } else if (key === "INTERVAL") {
      const n = parseInt(val, 10);
      if (Number.isFinite(n) && n >= 1) interval = n;
    }
  }

  // An INTERVAL with no recognized FREQ isn't a usable recurrence.
  if (!freq) return { freq: null, interval: 1 };
  return { freq, interval };
}

/**
 * Build the normalized RRULE string from a freq + interval. Returns "" for a
 * null freq ("does not repeat"). The INTERVAL clause is omitted when it equals
 * 1, so `buildRecurrenceRule("WEEKLY", 1)` => `FREQ=WEEKLY`.
 */
export function buildRecurrenceRule(
  freq: RecurrenceFreq | null,
  interval: number,
): string {
  if (!freq) return "";
  const n = Number.isFinite(interval) && interval >= 1 ? Math.floor(interval) : 1;
  return n > 1 ? `FREQ=${freq};INTERVAL=${n}` : `FREQ=${freq}`;
}

interface RecurrencePickerProps {
  /** Current RRULE string ("" / undefined = does not repeat). */
  value?: string | null;
  /** Called with the new normalized RRULE string ("" when set to no-repeat). */
  onChange: (rule: string) => void;
  disabled?: boolean;
  /** Optional id prefix so multiple pickers on a page stay unique. */
  idPrefix?: string;
}

export function RecurrencePicker({
  value,
  onChange,
  disabled,
  idPrefix = "recurrence",
}: RecurrencePickerProps) {
  // Derive state straight from the controlled `value` — no local state, so the
  // picker round-trips exactly what its parent stores (and parsing is cheap).
  const { freq, interval } = parseRecurrenceRule(value);

  const handleFreqChange = (next: RecurrenceFreq | "NONE") => {
    if (next === "NONE") {
      onChange("");
      return;
    }
    onChange(buildRecurrenceRule(next, interval));
  };

  const handleIntervalChange = (raw: string) => {
    if (!freq) return;
    const n = parseInt(raw, 10);
    onChange(buildRecurrenceRule(freq, Number.isFinite(n) && n >= 1 ? n : 1));
  };

  const unit = freq ? UNIT_NOUN[freq] : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <Label htmlFor={`${idPrefix}-freq`}>Repeats</Label>
        <Select
          value={freq ?? "NONE"}
          onValueChange={(v) => handleFreqChange(v as RecurrenceFreq | "NONE")}
          disabled={disabled}
        >
          <SelectTrigger id={`${idPrefix}-freq`}>
            <SelectValue placeholder="Does not repeat" />
          </SelectTrigger>
          <SelectContent>
            {FREQ_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {freq && unit && (
        <div>
          <Label htmlFor={`${idPrefix}-interval`}>Every</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`${idPrefix}-interval`}
              type="number"
              min={1}
              step={1}
              value={interval}
              onChange={(e) => handleIntervalChange(e.target.value)}
              disabled={disabled}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">
              {interval === 1 ? unit[0] : unit[1]}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
