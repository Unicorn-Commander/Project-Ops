/**
 * Tiny CSV export helper. RFC-4180 friendly: quotes any cell that
 * contains a comma, double-quote, or newline; doubles internal
 * quotes. No streaming — for the dashboard list pages we cap at
 * a few hundred rows so the entire CSV in memory is fine.
 *
 * Usage:
 *   downloadCsv("projects-2026-05-02.csv", [
 *     ["Number", "Title", "Client"],
 *     ["P-1", "Foo", "Acme"],
 *     ...
 *   ]);
 */

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function rowsToCsv(rows: Array<Array<unknown>>): string {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
}

export function downloadCsv(filename: string, rows: Array<Array<unknown>>): void {
  if (typeof window === "undefined") return;
  const csv = rowsToCsv(rows);
  // Prepend BOM so Excel recognises UTF-8.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Build a date-stamped filename like "projects-2026-05-02.csv".
 */
export function csvFilename(stem: string): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${stem}-${yyyy}-${mm}-${dd}.csv`;
}
