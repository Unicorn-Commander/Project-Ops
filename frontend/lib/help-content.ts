/**
 * Help-center content — the single source of truth for the in-app Help center
 * at `/dashboard/help`.
 *
 * This is intentionally plain data (no JSX, no imports) so it stays trivial to
 * extend, easy to search over client-side, and safe to import from anywhere.
 * The Help center renders categories → articles, and the search box filters
 * across every article's title, summary, keywords, and section text.
 *
 * GROUNDING: the copy here describes Project Ops as it actually ships at
 * v1.12.0 (see CHANGELOG.md). When a feature changes, update the matching
 * article body — keep this honest about what exists. Articles point at real
 * routes (e.g. `/dashboard/settings/custom-fields`) so the Help center can
 * deep-link the reader straight to the feature.
 *
 * Each article body is a list of blocks. Blocks render to clean typography in
 * the article panel:
 *   - { p }        a paragraph
 *   - { h }        a sub-heading
 *   - { list }     a bulleted list
 *   - { steps }    a numbered, ordered list (for "how to" sequences)
 *   - { note }     a tinted callout (variant: info | tip | warning)
 *   - { code }     a fenced monospace block (verbatim — e.g. a signature)
 *   - { kbd }      a row of keyboard-shortcut rows ([keys, label])
 */

/** A lucide icon name — resolved to a component in the Help UI's icon map. */
export type HelpIconName =
  | "Rocket"
  | "FolderKanban"
  | "LayoutGrid"
  | "CalendarRange"
  | "Repeat"
  | "SlidersHorizontal"
  | "Zap"
  | "Webhook"
  | "LineChart"
  | "Gauge"
  | "Clock"
  | "Building2"
  | "Bell"
  | "Bookmark"
  | "UserCircle"
  | "KeyRound"
  | "Keyboard";

export type HelpBlock =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "list"; items: string[] }
  | { type: "steps"; items: string[] }
  | { type: "note"; variant: "info" | "tip" | "warning"; text: string }
  | { type: "code"; text: string; caption?: string }
  | { type: "kbd"; rows: { keys: string[]; label: string }[] };

export interface HelpArticle {
  /** Stable slug — used for in-page anchors + the `?a=` deep-link param. */
  id: string;
  title: string;
  /** One-line description shown on the card grid + under the title. */
  summary: string;
  /** Extra search terms not already in title/summary/body. */
  keywords?: string[];
  /** A real dashboard route this article is "about" (renders an Open button). */
  route?: string;
  /** Label for the Open button (defaults to "Open"). */
  routeLabel?: string;
  body: HelpBlock[];
}

export interface HelpCategory {
  /** Stable slug — used for the `?c=` deep-link param + topic-nav anchor. */
  id: string;
  title: string;
  /** Short blurb under the category title in the topic nav / section header. */
  blurb: string;
  icon: HelpIconName;
  articles: HelpArticle[];
}

export const HELP_CATEGORIES: HelpCategory[] = [
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "getting-started",
    title: "Getting started",
    blurb: "Workspaces, roles, the dashboard, and finding anything fast.",
    icon: "Rocket",
    articles: [
      {
        id: "what-is-project-ops",
        title: "What is Project Ops?",
        summary:
          "A professional-services project hub: projects, tasks, time, billing, CRM, and a two-way client portal — usable by people and AI agents alike.",
        keywords: ["overview", "intro", "about", "unicorn commander", "suite"],
        body: [
          {
            type: "p",
            text: "Project Ops is where your team plans work, tracks the time spent on it, and turns that work into billable amounts and client deliverables. It runs projects and tasks, a Kanban board and a master schedule, time tracking and billing, a lightweight CRM (organizations + contacts), reporting, capacity planning, and a client portal — all scoped to your workspace.",
          },
          {
            type: "p",
            text: "Everything you can do in the dashboard, an AI agent can do too: Project Ops exposes the same actions over MCP and a REST API, secured by the same roles and workspace isolation. It's one of the apps in the Unicorn Commander suite.",
          },
          {
            type: "note",
            variant: "tip",
            text: "New here? Read 'Workspaces', then 'Roles & permissions', then take the dashboard tour below — that's the fastest path to feeling oriented.",
          },
        ],
      },
      {
        id: "workspaces",
        title: "Workspaces",
        summary:
          "A workspace is your isolated container of projects, tasks, contacts, and settings. You can belong to several and switch between them.",
        keywords: ["tenant", "tenancy", "switch", "organization", "isolation", "members", "share"],
        route: "/dashboard/settings",
        routeLabel: "Manage workspaces",
        body: [
          {
            type: "p",
            text: "A workspace is the boundary around everything you see: its projects, tasks, contacts, custom fields, automations, and webhooks belong to it and are invisible to any other workspace. This isolation is enforced at the database layer, not just the UI, so a workspace's data is provably private.",
          },
          {
            type: "h",
            text: "Switching workspaces",
          },
          {
            type: "p",
            text: "If you belong to more than one workspace, the workspace switcher in the top bar lets you change which one you're working in. The whole dashboard re-scopes to the workspace you pick.",
          },
          {
            type: "h",
            text: "Members & sharing",
          },
          {
            type: "p",
            text: "Open Settings → Workspaces to create a workspace and manage who's in it. Each member has a role (below) that governs what they can do inside that workspace.",
          },
        ],
      },
      {
        id: "roles",
        title: "Roles & permissions",
        summary:
          "ADMIN, MANAGER, STAFF, and CLIENT each see a different slice of Project Ops.",
        keywords: ["admin", "manager", "staff", "client", "rbac", "permissions", "access", "portal"],
        body: [
          {
            type: "p",
            text: "Your role decides which pages and actions are available to you. Roles are per-workspace.",
          },
          {
            type: "list",
            items: [
              "ADMIN — full control: everything a manager can do, plus user management and tenant-wide settings (email, custom fields, webhooks).",
              "MANAGER — runs the work: approvals, billing, capacity planning, automations, and profitability reporting are manager-gated.",
              "STAFF — does the work: projects, tasks, time tracking, documents, and the CRM. No access to manager-only billing/approval surfaces.",
              "CLIENT — sees only the client portal for their own projects: approvals, comments, and invoices. No access to the internal dashboard.",
            ],
          },
          {
            type: "note",
            variant: "info",
            text: "If a nav item or button isn't visible to you, it's almost always because your role doesn't include it. Ask a workspace ADMIN to adjust your role or grant access.",
          },
        ],
      },
      {
        id: "dashboard-tour",
        title: "The dashboard",
        summary:
          "How the app is laid out: the grouped sidebar, the top bar, and the page you land on.",
        keywords: ["layout", "sidebar", "navigation", "nav", "home", "tour", "groups"],
        route: "/dashboard",
        routeLabel: "Go to dashboard",
        body: [
          {
            type: "p",
            text: "The left sidebar groups the app into four sections — Workspace, Time & Billing, CRM, and Admin — so the navigation reads as a few short lists. You only see the items your role allows.",
          },
          {
            type: "p",
            text: "The top bar carries the page title, the command palette (Search…), the running timer widget, the assistant, the workspace switcher, your notifications bell, the light/dark theme toggle, and your account menu.",
          },
          {
            type: "list",
            items: [
              "Dashboard — your at-a-glance home: active projects, your tasks, and recent activity.",
              "My Tasks — every task assigned to you across projects.",
              "Triage — a review inbox for incoming candidate action items before they become real tasks.",
              "Projects / Kanban / Schedule — three views of the same work.",
            ],
          },
        ],
      },
      {
        id: "command-palette",
        title: "Search anything (⌘K)",
        summary:
          "One keystroke jumps to any project, task, contact, or organization — and runs quick actions.",
        keywords: ["cmd k", "ctrl k", "command palette", "search", "jump", "quick actions", "find", "spotlight"],
        body: [
          {
            type: "p",
            text: "Press ⌘K (Ctrl K on Windows/Linux) anywhere in the dashboard to open the command palette. Start typing to filter across your projects, tasks, contacts, and organizations at once; results filter live as you type.",
          },
          {
            type: "p",
            text: "With the box empty you get fast paths instead: your Starred items, your Recent pages (the last few detail pages you visited), and Quick actions like 'New project' or 'Go to Kanban'.",
          },
          {
            type: "kbd",
            rows: [
              { keys: ["⌘", "K"], label: "Open the palette (also ⌘ /)" },
              { keys: ["↑", "↓"], label: "Move through results" },
              { keys: ["↵"], label: "Open the highlighted result" },
              { keys: ["Esc"], label: "Close the palette" },
            ],
          },
          {
            type: "note",
            variant: "tip",
            text: "Star a project, contact, or organization (or pin a task) and it shows up at the top of the empty palette on every page — your personal jump-back list.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "projects-tasks",
    title: "Projects & tasks",
    blurb: "Create work, set status & priority, and break it down with subtasks and dependencies.",
    icon: "FolderKanban",
    articles: [
      {
        id: "projects",
        title: "Projects",
        summary:
          "The container for related work. Each has a number, a client, a status, and its own tasks, documents, time, and billing.",
        keywords: ["project", "create", "client", "project number", "status", "archive"],
        route: "/dashboard/projects",
        routeLabel: "Open Projects",
        body: [
          {
            type: "p",
            text: "A project groups the tasks, documents, time entries, and billing for one engagement. Every project gets an auto-assigned project number and can be linked to a client organization and contact.",
          },
          {
            type: "steps",
            items: [
              "Go to Projects and click New project (or use ⌘K → 'New project').",
              "Give it a title, optionally pick the client organization/contact, and set the status.",
              "Open the project to add tasks, upload documents, set billing policy, and request client approvals.",
            ],
          },
          {
            type: "h",
            text: "Project status",
          },
          {
            type: "list",
            items: [
              "NEW — created, not yet started.",
              "IN_PROGRESS — actively being worked.",
              "UNDER_REVIEW — work done, awaiting review/sign-off.",
              "ON_HOLD — paused.",
              "COMPLETED — finished.",
              "ARCHIVED — closed out and tucked away.",
            ],
          },
        ],
      },
      {
        id: "tasks",
        title: "Tasks: status, priority & type",
        summary:
          "The unit of work. Tasks carry a status, a priority, a type, an assignee, a due date, and an effort estimate.",
        keywords: ["task", "todo", "status", "priority", "due date", "assignee", "milestone", "deliverable", "estimate", "category", "tags"],
        route: "/dashboard/my-tasks",
        routeLabel: "Open My Tasks",
        body: [
          {
            type: "p",
            text: "Create a task from a project, from My Tasks, or with ⌘K → 'New task'. Edit a task to change any of its fields; status changes are also a quick drag on the Kanban board.",
          },
          {
            type: "h",
            text: "Status",
          },
          {
            type: "list",
            items: [
              "PENDING — not started.",
              "IN_PROGRESS — being worked on.",
              "WAITING_FOR_CLIENT — blocked on a client response.",
              "COMPLETED — done.",
              "CANCELLED — won't be done.",
            ],
          },
          {
            type: "h",
            text: "Priority",
          },
          {
            type: "p",
            text: "LOW, MEDIUM, HIGH, or URGENT — colour-coded everywhere a task appears so the urgent ones stand out at a glance.",
          },
          {
            type: "h",
            text: "Type",
          },
          {
            type: "p",
            text: "Tasks have a type — Task, Milestone, Deliverable, Review, Meeting, Research, or Other — so a schedule or board can tell a milestone apart from routine work.",
          },
          {
            type: "h",
            text: "Estimate",
          },
          {
            type: "p",
            text: "Set an effort estimate in hours on a task. Estimates roll up into capacity planning to show who's over- or under-committed.",
          },
          {
            type: "note",
            variant: "tip",
            text: "Need your own attributes — a client code, a billing category, a launch date? Add a custom field (Settings → Custom fields) and it appears right on the task form. See 'Custom fields'.",
          },
        ],
      },
      {
        id: "subtasks",
        title: "Subtasks",
        summary: "Break a task into smaller pieces nested under a parent.",
        keywords: ["subtask", "child task", "parent", "breakdown", "checklist", "nest"],
        body: [
          {
            type: "p",
            text: "A subtask is a task with a parent. Use subtasks to break a larger piece of work into the concrete steps that make it up, while keeping them grouped under the parent task.",
          },
          {
            type: "p",
            text: "Open a task to see and add its subtasks; each subtask is a full task in its own right, with its own status, assignee, comments, and (if you want) its own subtasks. A task shows a count of its subtasks so you can see how it's broken down.",
          },
        ],
      },
      {
        id: "dependencies",
        title: "Task dependencies",
        summary:
          "Say that one task can't start until another finishes — Project Ops tracks the order.",
        keywords: ["dependency", "depends on", "blocked by", "predecessor", "successor", "order", "sequence", "blocker"],
        body: [
          {
            type: "p",
            text: "A dependency is a directed link between two tasks: a successor depends on a predecessor. It records that the successor shouldn't begin (or can't finish) until the predecessor is done.",
          },
          {
            type: "p",
            text: "On a task you'll see both directions: what this task depends on, and what depends on it. The master schedule uses these links to lay work out in the right order.",
          },
          {
            type: "note",
            variant: "info",
            text: "Dependencies describe intent and ordering; they don't hard-block you from changing a status. They make the sequence of work visible across the schedule and the task detail.",
          },
        ],
      },
      {
        id: "kanban",
        title: "Kanban board",
        summary: "A drag-and-drop board of your tasks, grouped into status columns.",
        keywords: ["kanban", "board", "columns", "drag", "drop", "swimlane", "status"],
        route: "/dashboard/kanban",
        routeLabel: "Open Kanban",
        body: [
          {
            type: "p",
            text: "The Kanban board lays tasks out as cards in columns by status. Drag a card to a new column to change its status — no form needed. It's the fastest way to move a batch of work along.",
          },
          {
            type: "p",
            text: "Status pills on the board render as solid, saturated colours so the state of every card reads as a hard signal at a distance.",
          },
        ],
      },
      {
        id: "schedule",
        title: "Master schedule",
        summary:
          "A timeline (Gantt) view across projects, honouring due dates and dependencies.",
        keywords: ["schedule", "gantt", "timeline", "calendar", "roadmap", "milestones", "dates"],
        route: "/dashboard/schedule",
        routeLabel: "Open Schedule",
        body: [
          {
            type: "p",
            text: "The master schedule plots your work on a timeline so you can see what's happening when, across projects. Due dates place tasks on the calendar, and task dependencies order them.",
          },
          {
            type: "note",
            variant: "tip",
            text: "Jump straight here with ⌘K → 'Go to Schedule'.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "recurring",
    title: "Recurring work",
    blurb: "Make a task or project repeat on a schedule.",
    icon: "Repeat",
    articles: [
      {
        id: "repeats",
        title: "Recurring tasks & projects",
        summary:
          "Set a 'Repeats' rule and Project Ops materializes the next instance automatically.",
        keywords: ["recurring", "repeat", "repeats", "rrule", "daily", "weekly", "monthly", "interval", "cron", "recurrence", "schedule"],
        body: [
          {
            type: "p",
            text: "If the same work comes around on a cadence — a weekly status report, a monthly close — make it recurring instead of recreating it by hand. On the create/edit form, open the 'Repeats' picker and choose how often it should recur.",
          },
          {
            type: "h",
            text: "How the schedule is expressed",
          },
          {
            type: "p",
            text: "A recurrence is a simple rule: a frequency of DAILY, WEEKLY, or MONTHLY, plus an interval (every N of that unit). For example, WEEKLY with interval 2 means every two weeks; MONTHLY with interval 1 means every month.",
          },
          {
            type: "h",
            text: "What happens",
          },
          {
            type: "p",
            text: "The item you set the rule on becomes a recurrence template. A daily background job reads templates and materializes the next instance when it's due — so the next occurrence simply appears, ready to work, without anyone recreating it.",
          },
          {
            type: "note",
            variant: "info",
            text: "Because instances are created by a once-a-day job, a new occurrence shows up on its schedule date, not the instant you save the rule.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "custom-fields",
    title: "Custom fields",
    blurb: "Add your own attributes to tasks and projects.",
    icon: "SlidersHorizontal",
    articles: [
      {
        id: "custom-fields-overview",
        title: "Custom fields",
        summary:
          "Define workspace-specific fields — text, number, date, select, multi-select, checkbox — on tasks and projects.",
        keywords: ["custom field", "custom fields", "metadata", "attribute", "field", "select", "dropdown", "boolean", "text", "number", "date"],
        route: "/dashboard/settings/custom-fields",
        routeLabel: "Open Custom fields",
        body: [
          {
            type: "p",
            text: "Custom fields let you capture the attributes your team cares about that aren't built in — a client matter number, a billing category, a target launch date, a yes/no flag. They're defined per workspace and attached to either tasks or projects.",
          },
          {
            type: "h",
            text: "The six field types",
          },
          {
            type: "list",
            items: [
              "Text — a free-form string.",
              "Number — a numeric value.",
              "Date — a calendar date.",
              "Select (one) — a single choice from a list of options you define.",
              "Multi-select — any number of choices from your list of options.",
              "Checkbox — a true/false toggle.",
            ],
          },
          {
            type: "h",
            text: "Where they appear",
          },
          {
            type: "p",
            text: "Once you define a field for an entity, it renders right on that entity's create and edit forms and on the task detail. ADMINs manage the definitions; everyone fills in the values as they work.",
          },
          {
            type: "steps",
            items: [
              "Go to Settings → Custom fields (ADMIN only).",
              "Add a field: pick whether it lives on tasks or projects, give it a label, choose a type, and (for select / multi-select) list the options.",
              "Optionally mark it required, and set its order among your fields.",
              "Open a task or project — your field is now part of the form.",
            ],
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "automations",
    title: "Automations",
    blurb: "When → If → Then rules that run on your work automatically.",
    icon: "Zap",
    articles: [
      {
        id: "automations-overview",
        title: "Automations (rules engine)",
        summary:
          "Build no-code rules: a trigger, optional conditions, and one or more actions that fire automatically.",
        keywords: ["automation", "automations", "rule", "rules", "trigger", "condition", "action", "when then", "zapier", "workflow", "no-code"],
        route: "/dashboard/automations",
        routeLabel: "Open Automations",
        body: [
          {
            type: "p",
            text: "Automations are When → If → Then rules over what happens in your workspace. When a matching event fires, Project Ops checks your conditions, and if they all pass, it runs your actions — no code, no clicking. The builder shows a live plain-English preview of the rule as you assemble it.",
          },
          {
            type: "h",
            text: "When — the trigger",
          },
          {
            type: "p",
            text: "Pick the event that starts the rule: a task is created, a task's status changes, a task is assigned, a task is completed, a project is created, a project's status changes, or a comment is posted on a task.",
          },
          {
            type: "h",
            text: "If — the conditions (optional)",
          },
          {
            type: "p",
            text: "Add conditions that must all be true for the rule to act (logical AND). A condition compares a field from the event — like priority or the new status — using equals, not-equals, contains, greater-than, or less-than. Leave conditions empty to mean 'always'.",
          },
          {
            type: "h",
            text: "Then — the actions (the 5)",
          },
          {
            type: "list",
            items: [
              "Assign task — set the task's assignee.",
              "Set status — move the task to a status.",
              "Add comment — post a comment on the task.",
              "Create task — spin up a new task (with a title, optional priority, and project).",
              "Notify — send someone an in-app notification.",
            ],
          },
          {
            type: "h",
            text: "Toggle, templates & run counts",
          },
          {
            type: "p",
            text: "Each rule has an enable toggle and a run count so you can see how often it's firing. Start from a template for common patterns, then tweak. A built-in depth guard stops a rule's own writes from re-triggering itself into a loop.",
          },
          {
            type: "note",
            variant: "info",
            text: "Automations are a manager surface: ADMIN and MANAGER roles can create and manage rules. STAFF and CLIENT users don't see this page.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "webhooks",
    title: "Webhooks",
    blurb: "Send signed HTTP callbacks to your systems when work changes.",
    icon: "Webhook",
    articles: [
      {
        id: "webhooks-overview",
        title: "Outbound webhooks",
        summary:
          "Subscribe an HTTPS endpoint to task/project events and receive signed, retried deliveries with a full log.",
        keywords: ["webhook", "webhooks", "callback", "http", "event", "delivery", "subscribe", "integration", "endpoint", "retry"],
        route: "/dashboard/settings/webhooks",
        routeLabel: "Open Webhooks",
        body: [
          {
            type: "p",
            text: "A webhook lets Project Ops push events to your own systems in real time. You register an HTTPS endpoint, pick which events it should receive, and Project Ops POSTs a signed payload to it whenever one of those events happens.",
          },
          {
            type: "h",
            text: "Events you can subscribe to",
          },
          {
            type: "list",
            items: [
              "task.created — a task was created.",
              "task.status_changed — a task moved to a new status.",
              "task.assigned — a task was assigned to someone.",
              "task.completed — a task was marked complete.",
              "project.created — a project was created.",
              "project.status_changed — a project moved to a new status.",
              "task.comment.created — a comment was posted on a task.",
            ],
          },
          {
            type: "h",
            text: "Verifying a delivery",
          },
          {
            type: "p",
            text: "Every delivery is signed so you can prove it came from Project Ops and wasn't tampered with. The signature rides in the X-ProjectOps-Signature header in the form sha256=<hex>, where the hex is the HMAC-SHA256 of the raw request body keyed by your endpoint's signing secret. Recompute it on your side and compare.",
          },
          {
            type: "code",
            caption: "Verify X-ProjectOps-Signature (Node.js)",
            text: `import { createHmac, timingSafeEqual } from "crypto";

// header looks like: "sha256=<hex>"
const expected =
  "sha256=" + createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");

const ok = timingSafeEqual(
  Buffer.from(signatureHeader),
  Buffer.from(expected),
);`,
          },
          {
            type: "note",
            variant: "warning",
            text: "The signing secret (whsec_…) is shown ONCE, when you create the endpoint or rotate the secret. Copy it then — afterwards Project Ops only stores a non-reversible hint (…ab12) and can never show it again. Rotating issues a new secret and immediately invalidates the old one.",
          },
          {
            type: "h",
            text: "Retries & the delivery log",
          },
          {
            type: "p",
            text: "Failed deliveries are retried automatically. Every attempt is recorded in the endpoint's delivery log with its status (pending, success, or failed), so you can see exactly what was sent and what your receiver returned. Send a test ping from the endpoint to confirm your receiver before going live.",
          },
          {
            type: "note",
            variant: "info",
            text: "Webhooks are an ADMIN/MANAGER surface, and endpoints must be HTTPS.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "reports",
    title: "Reports",
    blurb: "Portfolio, profitability, and throughput — charts and tables.",
    icon: "LineChart",
    articles: [
      {
        id: "reports-overview",
        title: "Reporting",
        summary:
          "Three reports: Portfolio (budget vs logged), Profitability (margin & realization), and Throughput (completed over time).",
        keywords: ["report", "reports", "portfolio", "profitability", "throughput", "margin", "realization", "budget", "chart", "analytics"],
        route: "/dashboard/reports",
        routeLabel: "Open Reports",
        body: [
          {
            type: "p",
            text: "Reporting turns your projects and logged time into the numbers that tell you how the business is doing. Each report is a chart plus a sortable table.",
          },
          {
            type: "h",
            text: "Portfolio",
          },
          {
            type: "p",
            text: "A health view across projects: budget vs hours logged, billed vs budget, percent complete, and which projects are over budget. Good for a standing 'where does everything stand' read.",
          },
          {
            type: "h",
            text: "Profitability",
          },
          {
            type: "p",
            text: "The money view: billable vs billed amounts, cost, margin, and realization (how much of the work you actually billed). Because it exposes cost and margin, this report is manager-gated.",
          },
          {
            type: "h",
            text: "Throughput",
          },
          {
            type: "p",
            text: "Completed work over time — how much your team is finishing, charted across a period. A simple pulse on delivery pace.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "capacity",
    title: "Capacity planning",
    blurb: "Compare committed hours against each person's weekly capacity.",
    icon: "Gauge",
    articles: [
      {
        id: "capacity-overview",
        title: "Capacity planning",
        summary:
          "See who's over- or under-allocated by stacking task estimates against a per-person weekly capacity.",
        keywords: ["capacity", "workload", "allocation", "over-allocated", "weekly capacity", "estimate", "hours", "resourcing", "planning", "utilization"],
        route: "/dashboard/capacity",
        routeLabel: "Open Capacity",
        body: [
          {
            type: "p",
            text: "Capacity planning answers 'who has room and who's swamped?'. It sums each person's committed hours — the estimated hours on the tasks assigned to them — and compares that against their capacity for the window.",
          },
          {
            type: "h",
            text: "How capacity is computed",
          },
          {
            type: "p",
            text: "Each person has a weekly capacity in hours. For any window you look at, Project Ops pro-rates it (weekly capacity × days in window ÷ 7), then shows committed hours against it with utilization bands and an over-allocation flag for anyone past 100%.",
          },
          {
            type: "h",
            text: "Estimates are the fuel",
          },
          {
            type: "p",
            text: "The whole view is driven by task estimates, so it also warns you about unestimated tasks — work that's assigned but has no hours, and therefore isn't counted. Fill in estimates to make the picture accurate.",
          },
          {
            type: "steps",
            items: [
              "Make sure assigned tasks have an estimate (hours) on them.",
              "Set each person's weekly capacity — ADMIN/MANAGER can do this from the capacity view.",
              "Read the bands: green is comfortable, and an over-allocation flag marks anyone committed beyond their capacity.",
            ],
          },
          {
            type: "note",
            variant: "info",
            text: "The team view and setting someone's capacity are manager-gated; you can always see your own workload at any time.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "time-billing",
    title: "Time tracking & billing",
    blurb: "Log hours, submit timesheets, and turn approved time into invoices.",
    icon: "Clock",
    articles: [
      {
        id: "time-tracking",
        title: "Time tracking",
        summary:
          "Run a timer or enter time by hand, then submit a weekly timesheet for approval.",
        keywords: ["time", "timer", "time entry", "log time", "timesheet", "approve", "hours", "stopwatch", "tracking"],
        route: "/dashboard/time",
        routeLabel: "Open Time entries",
        body: [
          {
            type: "p",
            text: "Track the time you spend on tasks and projects two ways: start the timer in the top bar and stop it when you're done, or add a manual entry after the fact. Project Ops keeps at most one running timer per person, and guards against overlapping manual entries.",
          },
          {
            type: "h",
            text: "Timesheets & approval",
          },
          {
            type: "p",
            text: "Time rolls up into a weekly timesheet. Submit yours for review; a manager approves or rejects it. Approving locks the entries so the numbers behind billing can't shift underneath an invoice.",
          },
          {
            type: "steps",
            items: [
              "Start the timer on a task (top bar), or add a manual time entry.",
              "At week's end, open Timesheets and submit your week.",
              "A manager approves it; approved time is locked.",
            ],
          },
        ],
      },
      {
        id: "billing",
        title: "Billing & invoices",
        summary:
          "Approved, billable hours become invoice line items — with rates resolved automatically and no double-billing.",
        keywords: ["billing", "invoice", "billable", "rate", "bill rate", "accounting", "realization", "draft", "rollup"],
        route: "/dashboard/billing",
        routeLabel: "Open Billing",
        body: [
          {
            type: "p",
            text: "Billing turns the hours your team logged into amounts you can invoice. A project sets its billing policy (bill by default, default rate, budget), and a task can override the rate. When time is billed, Project Ops resolves the right rate through a clear precedence (task override → task → task type → project → contact → user → role → org).",
          },
          {
            type: "h",
            text: "From hours to invoice",
          },
          {
            type: "p",
            text: "Approved, billable, not-yet-billed time is grouped into invoice line items and sent to Accounting-Ops to invoice. The handoff carries a stable reference derived from the exact set of entries, so the same work is never billed twice. If Accounting-Ops isn't connected or reachable, you still get a draft and a PDF preview.",
          },
          {
            type: "note",
            variant: "info",
            text: "Billing is a manager surface. Cost rates feed margin and are never shown to CLIENT users.",
          },
        ],
      },
      {
        id: "agents",
        title: "Agents (activity & usage)",
        summary:
          "The agent analog of timesheets: a ledger of what your AI agents did, tracked by events plus token usage and cost — not hours.",
        keywords: [
          "agent",
          "agents",
          "agent activity",
          "agent usage",
          "ledger",
          "tokens",
          "token usage",
          "cost",
          "usage",
          "billable",
          "events",
          "mcp",
          "assistant",
          "ai usage",
          "metering",
        ],
        route: "/dashboard/agents",
        routeLabel: "Open Agents",
        body: [
          {
            type: "p",
            text: "Where time tracking answers 'what did the team do, and what's it billable at', Agents answers 'what did your AI agents do — and what did it cost'. Every action an agent takes against the workspace is recorded as a first-class, workspace-scoped event you can audit, chart, and mark billable. Agents are measured by events plus tokens and cost, not by hours.",
          },
          {
            type: "h",
            text: "What the ledger shows",
          },
          {
            type: "p",
            text: "Each entry records who acted (the agent — a Personal Access Token, the in-app assistant, a federated agent, a user, or the system), how the action arrived (MCP, API, the assistant, the GUI, or the system), the action itself, the entity it touched, any token counts in/out, a cost in USD, how long it took, a billable flag, and when it happened.",
          },
          {
            type: "list",
            items: [
              "KPI tiles — active agents, event count, tokens, and total + billable cost for the window.",
              "Roster — every agent that's been active, with its totals.",
              "Usage & cost charts — events and cost over time, plus a per-agent breakdown.",
              "Activity feed — a filterable, paginated stream (by agent, project, or channel) with an inline billable toggle on cost-bearing rows.",
            ],
          },
          {
            type: "note",
            variant: "info",
            text: "MCP tool calls are zero-cost actions: they count as events but carry no tokens or cost (shown as —). Only LLM turns — like an in-app assistant reply — carry tokens and a cost. So a busy agent that only reads and writes data via tools racks up events without spending anything.",
          },
          {
            type: "p",
            text: "Open an individual agent for a detail view — its totals, a per-project breakdown, and its recent activity — to see exactly where one agent is spending its events and tokens.",
          },
          {
            type: "note",
            variant: "info",
            text: "Agents is a manager surface, under Time & Billing → Agents: ADMIN and MANAGER roles see it. Like everything else, the ledger is workspace-scoped — you only ever see your own workspace's agent activity.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "crm",
    title: "CRM",
    blurb: "Organizations and the contacts inside them.",
    icon: "Building2",
    articles: [
      {
        id: "crm-overview",
        title: "Organizations & contacts",
        summary:
          "A lightweight CRM: companies you work with and the people at them, linkable to projects.",
        keywords: ["crm", "organization", "organisation", "company", "contact", "client", "people", "account"],
        route: "/dashboard/organizations",
        routeLabel: "Open Organizations",
        body: [
          {
            type: "p",
            text: "The CRM holds the companies you work with (organizations) and the people at them (contacts). Link a project to a client organization and contact so the work, the client, and eventually the invoice all line up.",
          },
          {
            type: "list",
            items: [
              "Organizations — the companies/accounts. Open one to see its contacts and related work. A client organization can be granted portal access.",
              "Contacts — the individual people, each tied to an organization, usable as a project's client contact and as an approver in the portal.",
            ],
          },
          {
            type: "note",
            variant: "tip",
            text: "Create either from ⌘K → 'New contact', or from the Organizations / Contacts pages.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "notifications",
    title: "Notifications & @mentions",
    blurb: "Stay in the loop with the bell and by being @mentioned.",
    icon: "Bell",
    articles: [
      {
        id: "notifications-overview",
        title: "Notifications & @mentions",
        summary:
          "The bell collects what needs your attention; @mention someone in a comment to pull them in.",
        keywords: ["notification", "notifications", "bell", "mention", "@mention", "alert", "comment", "ping"],
        body: [
          {
            type: "p",
            text: "The bell in the top bar collects things that need your attention — assignments, mentions, and activity on your work — so you can catch up in one place without watching every project.",
          },
          {
            type: "h",
            text: "@mentions",
          },
          {
            type: "p",
            text: "Type @ in a comment and pick a teammate to mention them. They get notified and pulled into the thread — the way to say 'this one's for you' without leaving the task. Comments update in real time, so a thread you're viewing fills in live.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "saved-views",
    title: "Saved views",
    blurb: "Save a filtered, sorted list so it's one click away.",
    icon: "Bookmark",
    articles: [
      {
        id: "saved-views-overview",
        title: "Saved views",
        summary:
          "Capture the filters and sort on any list page as a named view you can return to.",
        keywords: ["saved view", "saved views", "filter", "sort", "view", "list", "preset", "bulk actions"],
        body: [
          {
            type: "p",
            text: "Most list pages (projects, tasks, contacts, and more) let you filter and sort. When you've got a view you keep coming back to — 'my urgent tasks', 'over-budget projects' — save it as a named view and it's one click away next time, with its filters and sort intact. Each page also ships with a few built-in starting points.",
          },
          {
            type: "note",
            variant: "tip",
            text: "List pages also support bulk actions and CSV export (with a date-range + status scope), so you can act on or pull out exactly the rows a view shows.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "client-portal",
    title: "Client portal",
    blurb: "What your clients can do: approvals, comments, and invoices.",
    icon: "UserCircle",
    articles: [
      {
        id: "client-portal-overview",
        title: "The client portal",
        summary:
          "A focused, two-way space where clients approve work, comment on their projects, and view invoices.",
        keywords: ["client portal", "portal", "client", "approval", "approve", "reject", "request changes", "invoice", "pay", "external"],
        body: [
          {
            type: "p",
            text: "The client portal is the slice of Project Ops your clients see — and only their own projects. A CLIENT user signs in to a focused space, not the internal dashboard. It's a two-way channel: clients act, and your team sees those actions on the project page immediately.",
          },
          {
            type: "h",
            text: "What clients can do",
          },
          {
            type: "list",
            items: [
              "Approvals — approve, reject, or request changes on documents, deliverables, and projects your team sends for sign-off.",
              "Comments — leave non-internal comments on their projects to ask questions and give direction.",
              "Invoices — view their invoices, with a pay deep-link when there's a balance due (payment happens on your payment provider, not inside the app).",
            ],
          },
          {
            type: "h",
            text: "For your team",
          },
          {
            type: "p",
            text: "From a project you request an approval and pick the client contact who should sign off; their decision shows up live on the project page, so you always know what's been approved and what's still waiting.",
          },
          {
            type: "note",
            variant: "info",
            text: "Granting portal access is set on the client organization. Clients only ever see the projects that belong to them.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "automate",
    title: "Automate with MCP & the API",
    blurb: "Drive Project Ops from AI agents and your own integrations.",
    icon: "KeyRound",
    articles: [
      {
        id: "ai-assistant",
        title: "The AI assistant (Ask)",
        summary:
          "An in-app agent on every page that reads and acts on your work — listing, drilling in, creating, updating status, commenting, and drafting reports.",
        keywords: [
          "assistant",
          "ai",
          "ask",
          "ask pill",
          "chat",
          "agent",
          "copilot",
          "qwen",
          "llm",
          "on-prem",
          "local model",
          "private",
          "metered",
          "draft",
          "summarize",
        ],
        body: [
          {
            type: "p",
            text: "Every dashboard page has an Ask pill in the top bar. Open it and a sidebar agent — the Project Ops Assistant — slides in with live access to your projects, tasks, organizations, contacts, documents, billing, and activity. You can ask it to find and summarize work, drill into a project, create projects and tasks, change a status, post a comment, and draft status updates or stand-up notes — all in plain language.",
          },
          {
            type: "p",
            text: "Ask it things like 'what's still open on the Brigade integration?', 'break this project into tasks and assign them to me', 'mark TASK-0042 completed', or 'draft a status update for P-00002 covering the last week'. It runs as a full-height drawer or a popped corner widget and remembers your preference.",
          },
          {
            type: "h",
            text: "It only sees what you can",
          },
          {
            type: "p",
            text: "The assistant acts as you, under your role and inside your workspace — exactly the same RBAC and tenant isolation as the dashboard. A CLIENT asking 'what projects do I have?' sees only their own, and write actions refuse for roles that can't perform them. Every write the assistant makes lands in the same audit log as a manual change, so the activity feed shows it the same way.",
          },
          {
            type: "note",
            variant: "info",
            text: "The assistant runs on a private, on-prem model — a local Qwen 3.6 35B served through a metered LLM gateway — so your prompts and data stay on your own infrastructure rather than going to a third-party model. Assistant turns are metered (tokens and cost) and show up in the Agents ledger.",
          },
          {
            type: "note",
            variant: "tip",
            text: "Tell it your preferences once and it remembers them across sessions, scoped to your user: 'I want status updates as a PDF memo, not an email'. It can't generate images, and write tools occasionally need explicit field names — if a write doesn't take, re-ask naming the fields.",
          },
        ],
      },
      {
        id: "mcp-api-tokens",
        title: "MCP / API & Personal Access Tokens",
        summary:
          "Let Claude Code, ChatGPT, or your own code act in Project Ops with a scoped Personal Access Token.",
        keywords: ["mcp", "api", "token", "pat", "personal access token", "claude", "chatgpt", "integration", "agent", "scopes", "automation"],
        route: "/dashboard/settings",
        routeLabel: "Open Settings → API tokens",
        body: [
          {
            type: "p",
            text: "Everything in Project Ops is reachable by software, not just the UI. AI agents and your own integrations can read projects/tasks, post comments, create work, log time, and more over MCP and a REST API — secured by the same roles and the same workspace isolation as the dashboard.",
          },
          {
            type: "h",
            text: "Personal Access Tokens (PATs)",
          },
          {
            type: "p",
            text: "A Personal Access Token lets an MCP client (Claude Code, ChatGPT, a custom script) talk to Project Ops as you. Create one under Settings → API tokens: give it a name, pick the scopes it's allowed to use (read/write for projects, tasks, documents, organizations, billing, and activity), and choose an expiry.",
          },
          {
            type: "steps",
            items: [
              "Go to Settings → API tokens and click Create token.",
              "Name it (e.g. 'Claude Code on my Mac'), select the least-privilege scopes it needs, and pick an expiry.",
              "Copy the token when it's shown — it appears exactly once.",
              "Paste it into your MCP client's configuration.",
            ],
          },
          {
            type: "note",
            variant: "warning",
            text: "Treat a token like a password — anyone with it can act as you, within its scopes. It's shown only once on create; if you lose it, revoke it and make a new one. Prefer a finite expiry over 'never'. Scope rules apply to MCP tool calls; other endpoints still honour your underlying role.",
          },
        ],
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    blurb: "Move faster with the keyboard.",
    icon: "Keyboard",
    articles: [
      {
        id: "shortcuts-overview",
        title: "Keyboard shortcuts",
        summary: "The shortcuts worth knowing — starting with the command palette.",
        keywords: ["keyboard", "shortcut", "shortcuts", "hotkey", "cmd", "ctrl", "keys", "palette"],
        body: [
          {
            type: "p",
            text: "Project Ops is keyboard-first where it counts. The command palette is the big one — it gets you anywhere and runs the common create actions.",
          },
          {
            type: "h",
            text: "Global",
          },
          {
            type: "kbd",
            rows: [
              { keys: ["⌘", "K"], label: "Open the command palette" },
              { keys: ["⌘", "/"], label: "Open the command palette (alternate)" },
            ],
          },
          {
            type: "h",
            text: "Inside the command palette",
          },
          {
            type: "kbd",
            rows: [
              { keys: ["↑", "↓"], label: "Move through results" },
              { keys: ["↵"], label: "Open the highlighted result / run the action" },
              { keys: ["Esc"], label: "Close the palette" },
            ],
          },
          {
            type: "note",
            variant: "tip",
            text: "On Windows/Linux use Ctrl in place of ⌘. The Search button in the top bar shows your platform's shortcut and opens the same palette.",
          },
        ],
      },
    ],
  },
];

// ── Search ────────────────────────────────────────────────────────────────

/** A flattened article carrying its category for result rendering + linking. */
export interface HelpSearchHit {
  category: HelpCategory;
  article: HelpArticle;
}

/** Pull every searchable word out of an article (title/summary/keywords/body). */
function articleHaystack(article: HelpArticle): string {
  const parts: string[] = [article.title, article.summary, ...(article.keywords ?? [])];
  for (const block of article.body) {
    switch (block.type) {
      case "p":
      case "h":
        parts.push(block.text);
        break;
      case "list":
      case "steps":
        parts.push(...block.items);
        break;
      case "note":
      case "code":
        parts.push(block.text);
        break;
      case "kbd":
        parts.push(...block.rows.map((r) => r.label));
        break;
    }
  }
  return parts.join("  ").toLowerCase();
}

// Precompute the lowercased haystack once per article (module-load) so typing
// in the search box is a cheap substring scan, never a re-walk of every block.
const HAYSTACKS: Map<string, string> = new Map();
for (const category of HELP_CATEGORIES) {
  for (const article of category.articles) {
    HAYSTACKS.set(`${category.id}/${article.id}`, articleHaystack(article));
  }
}

/**
 * Search the help content for a query. Empty/whitespace query returns []
 * (the caller shows the full browse experience instead). Multi-word queries
 * are AND-matched: every term must appear somewhere in the article.
 */
export function searchHelp(query: string): HelpSearchHit[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const hits: HelpSearchHit[] = [];
  for (const category of HELP_CATEGORIES) {
    for (const article of category.articles) {
      const hay = HAYSTACKS.get(`${category.id}/${article.id}`) ?? "";
      if (terms.every((t) => hay.includes(t))) {
        hits.push({ category, article });
      }
    }
  }
  return hits;
}

/** Total article count — used for the "browse N articles" hint. */
export const HELP_ARTICLE_COUNT = HELP_CATEGORIES.reduce(
  (n, c) => n + c.articles.length,
  0,
);
