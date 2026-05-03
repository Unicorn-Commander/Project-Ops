"use client";

/**
 * Export CSV button + scope popover. Opens a small panel that lets the
 * user further refine the export (date range + status) without touching
 * the list page's active filters. The default export is the same data
 * the list is currently showing — pick "Export N records" without
 * changing anything to keep that behaviour.
 *
 * Usage:
 *   <ExportCsvButton
 *     data={filteredProjects}
 *     filenameStem="projects"
 *     dateField={{ key: "createdAt", label: "Created" }}
 *     statusField={{
 *       label: "Status",
 *       options: [{ value: "NEW", label: "New" }, ...],
 *       get: (p) => p.status,
 *     }}
 *     buildHeader={() => ["Number", "Title", ...]}
 *     buildRow={(p) => [p.projectNumber, p.title, ...]}
 *   />
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download as DownloadIcon, Calendar as CalendarIcon, Filter as FilterIcon, X as XIcon } from "lucide-react";
import { downloadCsv, csvFilename } from "@/lib/csv-export";

export interface ExportCsvDateField<T> {
  /** Human label for the date column ("Created", "Due"). */
  label: string;
  /** Pull the date out of one record. Anything Date-parseable. */
  get: (item: T) => string | Date | number | null | undefined;
}

export interface ExportCsvStatusField<T> {
  label: string;
  options: Array<{ value: string; label: string }>;
  get: (item: T) => string | null | undefined;
}

export interface ExportCsvButtonProps<T> {
  data: T[];
  filenameStem: string;
  buildHeader: () => Array<unknown>;
  buildRow: (item: T) => Array<unknown>;
  dateField?: ExportCsvDateField<T>;
  statusField?: ExportCsvStatusField<T>;
  /** Optional disabled-when-zero override; default is `data.length === 0`. */
  disabled?: boolean;
  /** Optional CSS for the trigger button. */
  className?: string;
}

type DatePreset = "ALL" | "7D" | "30D" | "90D" | "CUSTOM";

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "ALL", label: "All time" },
  { value: "7D", label: "Last 7 days" },
  { value: "30D", label: "Last 30 days" },
  { value: "90D", label: "Last 90 days" },
  { value: "CUSTOM", label: "Custom…" },
];

function presetWindow(preset: DatePreset): { from?: Date; to?: Date } {
  if (preset === "ALL" || preset === "CUSTOM") return {};
  const days = preset === "7D" ? 7 : preset === "30D" ? 30 : 90;
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from, to };
}

export function ExportCsvButton<T>(props: ExportCsvButtonProps<T>) {
  const {
    data,
    filenameStem,
    buildHeader,
    buildRow,
    dateField,
    statusField,
    disabled,
    className,
  } = props;

  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<DatePreset>("ALL");
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [statusPicks, setStatusPicks] = useState<Set<string>>(new Set());
  const popRef = useRef<HTMLDivElement>(null);

  // Close on outside press + Escape. `pointerdown` covers mouse + touch +
  // pen in one listener (v1.6.58 — was mousedown-only, missed touch
  // dismissal on mobile).
  useEffect(() => {
    if (!open) return;
    const onPress = (e: PointerEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    let out = data;

    if (dateField) {
      const window = preset === "CUSTOM"
        ? {
            from: customFrom ? new Date(customFrom + "T00:00:00") : undefined,
            to: customTo ? new Date(customTo + "T23:59:59") : undefined,
          }
        : presetWindow(preset);
      if (window.from || window.to) {
        out = out.filter((item) => {
          const raw = dateField.get(item);
          if (!raw) return false;
          const t = new Date(raw).getTime();
          if (Number.isNaN(t)) return false;
          if (window.from && t < window.from.getTime()) return false;
          if (window.to && t > window.to.getTime()) return false;
          return true;
        });
      }
    }

    if (statusField && statusPicks.size > 0) {
      out = out.filter((item) => {
        const v = statusField.get(item);
        return v != null && statusPicks.has(v);
      });
    }

    return out;
  }, [data, preset, customFrom, customTo, statusPicks, dateField, statusField]);

  const isDisabled = disabled ?? data.length === 0;
  const hasActiveScope =
    (dateField && preset !== "ALL") || (statusField && statusPicks.size > 0);

  const onExport = () => {
    const rows: Array<Array<unknown>> = [
      buildHeader(),
      ...filtered.map(buildRow),
    ];
    downloadCsv(csvFilename(filenameStem), rows);
    setOpen(false);
  };

  const reset = () => {
    setPreset("ALL");
    setCustomFrom("");
    setCustomTo("");
    setStatusPicks(new Set());
  };

  return (
    <div className="relative inline-block" ref={popRef}>
      <Button
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        disabled={isDisabled}
        className={className}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <DownloadIcon className="mr-2 h-4 w-4" />
        Export CSV
        {hasActiveScope && (
          <span className="ml-2 inline-flex items-center justify-center rounded-full bg-primary/15 text-primary text-[10px] font-semibold px-1.5 py-0.5 leading-none">
            scoped
          </span>
        )}
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Export CSV options"
          className="absolute right-0 z-50 mt-2 w-[320px] rounded-lg border border-border bg-card shadow-lg p-4 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-foreground">Export options</div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <XIcon className="h-4 w-4" />
            </button>
          </div>

          {dateField && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <CalendarIcon className="h-3.5 w-3.5" />
                {dateField.label} — date range
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DATE_PRESETS.map((p) => {
                  const active = preset === p.value;
                  return (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setPreset(p.value)}
                      className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                        active
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "bg-background border-border text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              {preset === "CUSTOM" && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="text-xs text-muted-foreground space-y-1">
                    <span>From</span>
                    <input
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  </label>
                  <label className="text-xs text-muted-foreground space-y-1">
                    <span>To</span>
                    <input
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {statusField && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <FilterIcon className="h-3.5 w-3.5" />
                  {statusField.label}
                </div>
                {statusPicks.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setStatusPicks(new Set())}
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {statusField.options.map((opt) => {
                  const active = statusPicks.has(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        const next = new Set(statusPicks);
                        if (active) next.delete(opt.value);
                        else next.add(opt.value);
                        setStatusPicks(next);
                      }}
                      className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                        active
                          ? "bg-primary/15 border-primary/40 text-primary"
                          : "bg-background border-border text-foreground hover:bg-muted/50"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="border-t border-border pt-3 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{filtered.length}</span>{" "}
              of {data.length} record{data.length === 1 ? "" : "s"}
            </div>
            <div className="flex items-center gap-2">
              {hasActiveScope && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Reset
                </button>
              )}
              <Button size="sm" onClick={onExport} disabled={filtered.length === 0}>
                Export {filtered.length}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
