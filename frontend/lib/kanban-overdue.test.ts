import { equal } from "node:assert/strict";
import { test } from "node:test";
import { isTaskOverdue } from "./kanban-overdue.ts";

const now = new Date("2026-11-06T12:00:00-05:00");

test("marks an open task with a past due date as overdue", () => {
  equal(isTaskOverdue({ dueDate: "2026-11-05", status: "PENDING" }, now), true);
});

test("never marks completed or cancelled tasks as overdue", () => {
  equal(isTaskOverdue({ dueDate: "2026-11-05", status: "COMPLETED" }, now), false);
  equal(isTaskOverdue({ dueDate: "2026-11-05", status: "CANCELLED" }, now), false);
});

test("does not mark today or future open tasks as overdue", () => {
  equal(isTaskOverdue({ dueDate: "2026-11-06", status: "IN_PROGRESS" }, now), false);
  equal(isTaskOverdue({ dueDate: "2026-11-07", status: "IN_PROGRESS" }, now), false);
});
