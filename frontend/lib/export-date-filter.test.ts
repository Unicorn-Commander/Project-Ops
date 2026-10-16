import { equal, deepEqual } from "node:assert/strict";
import { test } from "node:test";
import {
  exportDateWindow,
  matchesExportDateWindow,
} from "./export-date-filter.ts";

test("date-only From/To bounds keep a row due on the From day", () => {
  const window = exportDateWindow(
    "date-only",
    "CUSTOM",
    "2026-10-16",
    "2026-10-16",
    new Date("2026-10-16T12:00:00.000Z"),
  );

  deepEqual(window, { from: "2026-10-16", to: "2026-10-16" });
  equal(
    matchesExportDateWindow(
      new Date("2026-10-16T00:00:00.000Z"),
      window,
      "date-only",
    ),
    true,
  );
  equal(
    matchesExportDateWindow(
      new Date("2026-10-15T00:00:00.000Z"),
      window,
      "date-only",
    ),
    false,
  );
});
