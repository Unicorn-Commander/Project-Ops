import type { CreateAutomationRuleData } from "@/lib/automations-api";

/**
 * Starter templates surfaced in the empty state (and as quick "Start from a
 * template" chips). Each is a ready-to-edit {@link CreateAutomationRuleData}:
 * picking one opens the builder pre-filled so a first-time user sees a working
 * rule rather than a blank canvas.
 *
 * Templates intentionally leave user/project ids blank (the builder's pickers
 * fill those in) so they're workspace-agnostic.
 */
export interface AutomationTemplate {
  id: string;
  title: string;
  blurb: string;
  rule: CreateAutomationRuleData;
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "urgent-task-notify",
    title: "Flag urgent tasks",
    blurb: "When a high-priority task is created, notify a teammate.",
    rule: {
      name: "Notify on urgent task",
      trigger: "TASK_CREATED",
      conditions: [{ field: "priority", op: "eq", value: "URGENT" }],
      actions: [{ type: "notify", params: { userId: "", message: "A new urgent task needs attention" } }],
    },
  },
  {
    id: "completed-followup",
    title: "Follow-up on completion",
    blurb: "When a task is completed, create a follow-up task.",
    rule: {
      name: "Create follow-up when a task completes",
      trigger: "TASK_COMPLETED",
      conditions: [],
      actions: [{ type: "create_task", params: { title: "Follow up", priority: "MEDIUM" } }],
    },
  },
  {
    id: "comment-notify",
    title: "Stay on top of comments",
    blurb: "When a comment is posted, notify the project lead.",
    rule: {
      name: "Notify on new comment",
      trigger: "COMMENT_CREATED",
      conditions: [],
      actions: [{ type: "notify", params: { userId: "" } }],
    },
  },
];
