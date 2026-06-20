# Project Ops — Feature guide

A tour of everything Project Ops does, organized by area. Each section
covers **what it is**, **how to use it**, and **any limits worth knowing**.

This is the user-facing guide; the developer-facing surfaces (MCP tools,
JWT minting, API wiring) live in
[`MCP_FOR_CODING_AGENTS.md`](MCP_FOR_CODING_AGENTS.md) and the AI assistant
in [`AI_ASSISTANT.md`](AI_ASSISTANT.md). For the per-release record of what
shipped, see [`../CHANGELOG.md`](../CHANGELOG.md).

Project Ops is **live in production** at
<https://projectops.unicorncommander.ai>; the dogfood instance at
<https://projectops.magicunicorn.dev> runs alongside it.

---

## Contents

- [Projects & tasks](#projects--tasks)
- [Subtasks & dependencies](#subtasks--dependencies)
- [Kanban board](#kanban-board)
- [Master schedule](#master-schedule)
- [Recurring tasks & projects](#recurring-tasks--projects)
- [Custom fields](#custom-fields)
- [Automations](#automations)
- [Webhooks](#webhooks)
- [Reporting](#reporting)
- [Capacity planning](#capacity-planning)
- [Time tracking & billing](#time-tracking--billing)
- [Agent activity & usage](#agent-activity--usage)
- [Two-way client portal](#two-way-client-portal)
- [CRM — organizations & contacts](#crm--organizations--contacts)
- [Documents](#documents)
- [Notifications & @mentions](#notifications--mentions)
- [Saved views](#saved-views)
- [List tooling — search, filter, sort, bulk, export](#list-tooling)
- [Workspaces & multi-tenancy](#workspaces--multi-tenancy)
- [Roles & permissions](#roles--permissions)
- [AI assistant, MCP & API](#ai-assistant-mcp--api)

---

## Projects & tasks

The core of Project Ops. A **project** holds client/org info, a timeline,
billing fields, and a set of tasks; a **task** is a unit of work on a
project.

**Projects** carry:

- **Status** — `NEW` · `IN_PROGRESS` · `UNDER_REVIEW` · `COMPLETED` ·
  `ARCHIVED`.
- **Priority** — `LOW` · `MEDIUM` · `HIGH` · `URGENT`.
- **Category** (a single free-text label) and **tags** (a list).
- Client name / email / phone, an optional linked **contact** and
  **organization**.
- A due date, a completion date, and billing fields (see
  [Time tracking & billing](#time-tracking--billing)).
- Each project auto-numbers — `P-XXXXX` for assistant/MCP-created projects,
  `PROJ-YYYY-XXXXXX` for the seed/web flow. Numbers are unique **per
  workspace**.

**Tasks** carry:

- **Status** — `PENDING` · `IN_PROGRESS` · `WAITING_FOR_CLIENT` ·
  `COMPLETED` · `CANCELLED`.
- **Priority** — `LOW` · `MEDIUM` · `HIGH` · `URGENT`.
- **Type** — `TASK` · `MILESTONE` · `DELIVERABLE` · `REVIEW` · `MEETING` ·
  `RESEARCH` · `OTHER`.
- An assignee, a due date, an optional **estimated hours** (feeds
  [capacity planning](#capacity-planning)), and per-task billing overrides.

**How to use.** Create a project from the Projects list (or via the
assistant / Cmd+K). Open `/dashboard/projects/[id]` to see a snapshot card
(completion %, status donut, priority bar, Total / Completed / Overdue) above
the task list, then add tasks inline. Edit a task's status straight from its
status pill on **My Tasks** without opening the modal.

---

## Subtasks & dependencies

**Subtasks** break a task into child tasks; **dependencies** model ordering
between tasks (e.g. "schema migration must finish before the frontend pass").

- **Subtasks** appear in the task-detail modal as a checklist — add one with
  the "Add subtask" field, mark complete with the checkbox. A subtask points
  at its parent via `parentTaskId`.
- **Dependencies** appear as two lists in the task-detail modal: **Depends
  on** (predecessors, `←`) and **Blocks** (successors, `→`). Add one by
  picking the target task plus a direction and a dependency type —
  `FINISH_TO_START` (default), `START_TO_START`, `FINISH_TO_FINISH`, or
  `START_TO_FINISH`.

**Limits.** Dependencies are validated server-side: **no cycles, no
duplicate links, no self-links**. The dependency *type* is recorded for
modeling; scheduling does not auto-shift dates from it today.

---

## Kanban board

A drag-and-drop board at `/dashboard/kanban`, columns by task status.

**How to use.** Drag a card between columns to change its status. Filters
narrow what's on the board. Empty states are explicit: an empty board shows a
**New task** call-to-action (and hides the columns until a task exists); a
board emptied by filters shows a **Clear filters** action.

---

## Master schedule

A timeline (Gantt) view of projects at `/dashboard/schedule`, grouped into
**swimlanes**.

**How to use.**

- **Group by** Organization · Category · Owner · Status · Flat — each group
  is a collapsible swimlane with a rollup span.
- Bars run a project across its timeline with a progress fill; a diamond marks
  the due date.
- **Drag a bar** to reschedule — the new due date is applied optimistically
  and saved in the background (a failed save reverts the bar). Completed
  projects and projects without a due date are not draggable.
- A summary ribbon shows live counts (Active · Overdue · Due this week · Avg
  progress); zoom controls switch the visible window (≈3-month to 18-month
  spreads).

---

## Recurring tasks & projects

Tasks and projects can **repeat on a schedule**. A recurring item is a
*template*; the system materializes the next *instance* automatically.

**The "Repeats" picker** (on the create/edit forms):

- **Does not repeat** (default) · **Daily** · **Weekly** · **Monthly**.
- Pick a frequency and an **Every N** interval shows up (every N days /
  weeks / months).

**What's supported.** Under the hood this is a deliberately small subset of
the RFC-5545 RRULE format, with **no extra dependency**:

```
FREQ=DAILY|WEEKLY|MONTHLY     (required)
INTERVAL=<positive integer>   (optional, default 1)
```

Examples: `FREQ=WEEKLY;INTERVAL=2` (every other week),
`FREQ=MONTHLY` (monthly). Other RRULE parts (`COUNT`, `UNTIL`, `BYDAY`, …)
are **ignored, not rejected** — a richer rule still yields a sane cadence; an
unsupported frequency (e.g. `YEARLY`) makes the item non-recurring.

**How materialization works.** A daily job (≈01:00) walks each template and
creates the next instance once it's within a one-day look-ahead of its due
date — so a task due tomorrow appears today. Monthly arithmetic clamps to the
last valid day (Jan 31 + 1 month → Feb 28/29). The job is **idempotent**:
re-running it never double-creates an occurrence. Each instance is a fresh,
open item (status `PENDING`) that copies the template's content; instances
never themselves spawn.

**Limits.** Daily granularity (a task can't appear more than a day before its
due date); no end date / occurrence count; intervals are whole numbers.

---

## Custom fields

Per-workspace, user-defined fields on **tasks** and **projects**.

**Field types** (6): **Text** · **Number** · **Date** · **Select** (one
choice) · **Multi-select** (many choices) · **Boolean** (checkbox). Select /
multi-select carry an options list.

**How to use.** Define fields under **Settings → Custom fields**
(`/dashboard/settings/custom-fields`), with separate sections for **Task
fields** and **Project fields**. Each definition has a label, an immutable
**key**, a type, a position (for ordering), and a required flag. Defined
fields then render on the relevant create/edit forms and task details, and
their values are stored on the entity.

**Limits.** A field's **key and entity are immutable** after creation (label,
type, options, position, and required can change). Keys are unique per
(workspace, entity). Values live in the entity's `metadata` JSON under a
`customFields` key — there's no separate per-value table, so they aren't
independently indexed for filtering.

---

## Automations

A **When → If → Then** rules engine ("Zapier-lite") that reacts to your
workspace's activity. Managed at `/dashboard/automations`.

**Triggers** (the "When"):

- `TASK_CREATED` · `TASK_STATUS_CHANGED` · `TASK_ASSIGNED` ·
  `TASK_COMPLETED` · `PROJECT_CREATED` · `PROJECT_STATUS_CHANGED` ·
  `COMMENT_CREATED`.

**Conditions** (the optional "If"): each compares a field on the event
(a dotted path like `priority`, `toStatus`, or `task.projectId`) against a
value using an operator — **`eq`**, **`neq`**, **`contains`**, **`gt`**, or
**`lt`**. All conditions must pass (logical **AND**); an empty condition list
means "always". String comparisons are case-insensitive; `contains` works on
strings (substring) and arrays (membership); `gt`/`lt` are numeric.

**Actions** (the "Then", 5 types):

- **assign_task** — assign the triggering task to a user.
- **set_status** — set the triggering task's status.
- **add_comment** — post a comment on the triggering task.
- **create_task** — create a task (on a given project, or the event's
  project).
- **notify** — send an in-app notification to a user.

**How to use.** The builder shows a trigger picker, optional conditions, an
ordered action list, an **enable toggle**, and a **live plain-English
preview** ("When a task is completed, if priority is HIGH → notify …"). The
list view shows each rule's **run count** and last-run time, plus totals
(rules / active / paused / runs).

**How it runs.** Actions execute through the real domain services as the
**rule's creator** (an ADMIN/MANAGER), so they get the same
validation/permissions/tenant fencing as a normal user action. A
**loop guard** stops an automation's own writes from re-triggering it: events
caused by an action don't spawn another generation past the configured depth
(`AUTOMATION_MAX_DEPTH`, default 1). A single failing rule or action is logged
and the rest continue — one bad rule never breaks the others.

**Limits.** Automations are an **ADMIN / MANAGER** surface. Task-mutating
actions need a resolvable rule creator and a target task on the event; if
neither is present the action is skipped (and logged). Note that a few trigger
events are forward-compatible — subscribing to one that isn't emitted yet is
simply inert.

---

## Webhooks

Outbound, **HMAC-signed** HTTP callbacks so external systems can react to
Project Ops events. Managed at **Settings → Webhooks**
(`/dashboard/settings/webhooks`).

**Subscribable events:**

```
task.created            project.created
task.status_changed     project.status_changed
task.assigned           task.comment.created
task.completed
```

**The signature scheme.** Every delivery is a POST whose JSON body is signed
with **HMAC-SHA256** under the endpoint's secret. Headers:

| Header | Meaning |
|---|---|
| `X-ProjectOps-Signature` | `sha256=<hex>` — HMAC-SHA256 of the **raw request body** |
| `X-ProjectOps-Event` | the event name (route without parsing the body) |
| `X-ProjectOps-Delivery` | the delivery id (dedupe retries) |

The body envelope (the exact bytes that are signed) is:

```json
{
  "event": "task.completed",
  "workspaceId": "…",
  "data": { },
  "timestamp": "2026-06-18T09:00:00.000Z"
}
```

**Verify a delivery** by recomputing the HMAC over the raw body and comparing
in constant time. Node example:

```js
import { createHmac, timingSafeEqual } from "crypto";

function verify(secret, rawBody, signatureHeader) {
  const expected = `sha256=${createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

> Sign over the **raw bytes you received**, before any JSON re-serialization —
> Project Ops signs exactly what it sends.

**Secrets.** The signing secret (`whsec_…`) is generated server-side and
**shown once** on create (and once again if you rotate it). After that the UI
only ever shows a last-4 hint (`…ab12`). There is no endpoint that returns the
full secret again — store it when you see it.

**Delivery, retries & the log.** Deliveries are signed and POSTed with a
5-second timeout; a non-2xx or network error is retried up to **3 total
attempts** with exponential backoff (2xx ⇒ `SUCCESS`, otherwise `FAILED`).
Every attempt is recorded — view the **delivery log** per endpoint (status,
response code, attempts, error), and use **Send test ping** to fire a
synthetic `ping` through the full signed path to confirm your receiver.

**Limits.** Endpoint URLs must be **`https`** (plain `http` is allowed only
for `localhost`/`127.0.0.1` dev receivers), so a secret-bearing POST never
crosses the wire in clear text. Webhooks are an **ADMIN / MANAGER** surface.
Delivery is in-process and best-effort; the delivery row is the durable record.

---

## Reporting

Three workspace reports at `/dashboard/reports`, each a tab with charts plus
sortable tables.

- **Portfolio** — per-project health roll-up: budgeted vs logged hours,
  billed/accrued vs budget amount, **% complete** (tasks done ÷ total),
  status, and an **over-budget** flag (hours or amount), with workspace totals
  (project/active counts, task totals, billable hours) and a status breakdown.
- **Profitability** — per-project and workspace **billable / billed / cost /
  margin / realization** (margin = billable − cost; realization = billed ÷
  billable). Accepts an optional `from`/`to` window.
- **Throughput** — tasks/projects **completed over time**, bucketed by week
  and status, over an optional window.

**Limits.** **Money is manager-gated**: the Profitability report (which
exposes internal cost and margin) is **ADMIN / MANAGER only**; CLIENT viewers
never see cost or margin anywhere. Reported figures use already-priced amounts
(no rate re-resolution at report time).

---

## Capacity planning

Who's over- or under-loaded, week by week. At `/dashboard/capacity`.

**The model.** Each member has a **weekly capacity** (hours; default **40**,
editable by a manager). For a date window, that weekly figure is **pro-rated**
to the window length (`weekly × windowDays ÷ 7`). **Committed hours** is the
sum of `estimatedHours` over a member's in-window, not-done tasks.
**Utilization %** = committed ÷ pro-rated capacity.

**Utilization bands** (the color legend):

- **< 85%** — green (headroom)
- **85–100%** — amber (full)
- **> 100%** — rose (**over-allocated**: committed strictly exceeds capacity)

**How to use.** The window defaults to the **current week** (Mon–Sun); a
navigator steps weeks (with a "This week" reset). The **team view**
(ADMIN/MANAGER) shows summary cards (team capacity, committed, overall
utilization, over-allocated count), a committed-vs-capacity chart, and a
workload board sorted most-loaded first; managers can edit a member's weekly
capacity inline. Any member can see their **own** load via `/capacity/me`.

**Limits.** Committed hours only counts tasks that have an **estimate** —
unestimated tasks are surfaced as a separate **"unestimated tasks" warning**
(a count, per person and overall) so the gap is visible rather than silently
under-counting load. Team capacity (and editing a member's hours) is
ADMIN/MANAGER only.

---

## Time tracking & billing

Turn logged work into billable amounts that can flow to Accounting-Ops for
invoicing.

- **Timers & manual entry** — start/stop a timer (at most one running per
  user) or log time manually; entries are guarded against overlaps and round
  per the project's rounding policy (raw + rounded both stored).
- **Billing rates** resolve most-specific-first: Task override → `TASK` →
  `TASK_TYPE` → `PROJECT` → project default → `CONTACT` → `USER_PROJECT` →
  `USER` → `ROLE` → `ORG`. A separate **cost rate** is resolved independently
  and **never shown to CLIENT**.
- **Timesheets** — a weekly submit → approve/reject flow; an approved
  timesheet locks its entries (billed entries are immutable).
- **Billable rollup → Accounting-Ops** — approved, billable, unbilled entries
  are grouped into invoice line items with a retry-safe reference so the same
  work never double-bills. When AO is reachable/entitled the invoice is created
  there; otherwise it degrades to a draft + PDF preview ("connect
  Accounting-Ops to invoice"). Invoice status is mirrored back onto the
  project's billing fields by a poller.
- **Reports** — utilization, realization, WIP, and CSV export.

**Limits.** Time tracking ships behind `TIME_TRACKING_ENABLED` (on by
default); the **live** AO rollup is behind `BILLABLE_ROLLUP_LIVE` (off until
the AO AR integration is signed off in production) — until then the rollup
produces a draft + preview rather than a live invoice.

---

## Agent activity & usage

The agent analog of time tracking. Time tracking answers "what did the *team*
do, and what's it billable at"; this answers "what did your *AI agents* do —
and what did it cost." Every agent action against the workspace is recorded as
a first-class, workspace-scoped **`AgentEvent`** you can audit, chart, and mark
billable — under **Time & Billing → Agents** (ADMIN/MANAGER).

**What's captured.** Each event records the actor (`actorKind` ∈
PAT / ASSISTANT / FEDERATED / USER / SYSTEM, with a stable `actorKey` + label),
how it arrived (`via` ∈ MCP / API / ASSISTANT / GUI / SYSTEM), the `action`, the
entity it touched (resource + optional project/task link), `tokensIn`/`tokensOut`,
`costUsd`, `durationMs`, a `billable` flag, and `occurredAt`.

- **Automatic capture.** An MCP tool call records an event after it succeeds
  (`via=MCP`, the tool name as the action) and an in-app assistant turn records
  one (`actorKind=ASSISTANT`). Capture is best-effort and never blocks the
  request.
- **MCP tool calls are zero-cost *actions*** — they count as events but carry no
  tokens/cost (shown as `—`). Only assistant/LLM events carry tokens.

**The Agents dashboard** (`/dashboard/agents`): KPI tiles (active agents,
events, tokens, total + billable cost), an agent roster, usage & cost charts
(events- and cost-over-time, per-agent breakdown), and a filterable, paginated
activity feed — filter by agent / project / channel, with an inline **billable**
toggle on cost-bearing rows. A per-agent detail page
(`/dashboard/agents/[actorKey]`) drills into one agent's totals, per-project
breakdown, and recent activity.

**API.** `GET /agents` (roster + totals), `GET /agents/activity`,
`GET /agents/usage`, `GET /agents/:actorKey`, `PATCH /agents/activity/:id/billable`
— all ADMIN/MANAGER-gated and workspace-RLS-scoped.

**Note.** The in-app assistant runs through a **metered LLM gateway** (a local,
on-prem Qwen 3.6 35B — see [AI assistant](#ai-assistant-mcp--api)), so assistant
turns record their token usage and carry a cost in the ledger. MCP tool calls
remain zero-cost actions (events only). Finer-grained per-event cost attribution
across every channel continues to be refined.

---

## Two-way client portal

A separate surface for **CLIENT**-role users (under `/client-portal`) where a
client sees only their own organization's work — and can now act on it.

- **Approvals** (`/client-portal/approvals`) — staff **request** an approval
  on a **document**, **deliverable**, or **project**; the client sees a
  "Waiting on you" list and **Approves**, **Requests changes**, or **Rejects**,
  each with an optional note. Decisions and history (status `PENDING` →
  `APPROVED` / `REJECTED` / `CHANGES_REQUESTED`) are visible to both sides;
  staff watch live client decisions from the project page.
- **Comments** — clients comment on their own projects; staff see them in the
  project thread. Internal-only comments are not shown to clients.
- **Invoices** (`/client-portal/invoices`) — read-only list with outstanding
  balance and per-invoice detail. When a balance is due, the invoice carries a
  **pay deep-link** (`payUrl`).

**Limits.** **No in-app payment** — the portal links out to pay; it never
takes a card. Clients can act only on **their own** org's projects/approvals,
enforced server-side. Staff request approvals; clients decide them (a client
can't request, a staff user can't decide as the client).

---

## CRM — organizations & contacts

A built-in CRM. **Organizations** (`AGENCY` · `BUSINESS` · `INDIVIDUAL` ·
`PARTNER`) support a **parent/child hierarchy** and per-org project rollups;
**contacts** are people, optionally linked to an org and to projects.

**How to use.** Manage both from `/dashboard/organizations` and
`/dashboard/contacts`. Org and contact detail pages open with a snapshot
(Active / Completed / Billed / Outstanding + status donut + priority bar).
Contact rows expose inline `mailto:`/`tel:` actions; org rows carry a
per-org color that follows that org's projects across the app. A contact can
be invited to the client portal via `/contacts/:id/invite` (creates a
password account; see [Roles & permissions](#roles--permissions)).

---

## Documents

Files attached to projects (and tasks), stored in an S3-compatible object
store.

**How to use.** Upload from the Documents page or a project; documents carry a
file type, size, and project link, and surface to the right people (a CLIENT
sees only documents shared to their org). The project detail page is
print-friendly for a paper status report.

---

## Notifications & @mentions

- **In-app notifications** — a bell in the top bar with an unread badge; the
  dropdown lists recent items (each links to its entity) with "Mark all as
  read". It polls ~30s and pauses when the tab is hidden. Always on.
- **Email notifications** — opt in to emails for the events you care about at
  **Settings → Notifications**: a master "Email notifications" switch plus a
  per-event map (task assigned, @mention, approval requested, status changes, …),
  with the high-signal events on by default. Email respects your preferences;
  in-app notifications stay on regardless.
- **@mentions** — mention a teammate in a task comment to notify them.

Notifications also back the automations **notify** action and assignment
events.

---

## Guidance & onboarding

Project Ops explains itself as you go.

- **Onboarding** — first-run staff get a short welcome tour and a "getting
  started" checklist (create your first project, add a task, try ⌘K, set up
  custom fields, explore Help) that checks items off as you complete them, and
  re-opens any time from the dashboard. Clients get a warm welcome in the portal.
- **Tooltips** — default-on, dismissible help hints sit beside non-obvious
  controls and deep-link to the matching Help-center article. Turn them off, or
  reset tips/tours, at **Settings → Help & guidance**.
- **Help center** — `/dashboard/help`: searchable, categorized guides for every
  feature.

---

## Saved views

Filter + sort presets per list page.

**How to use.** Set up filters/sort on a list, then **Save view** — give it a
name and optionally **share it with the workspace** (everyone can apply a
shared view; only the owner edits it). Built-in starting points ship per page
(e.g. Projects: "Active only", "Urgent priority", "Recently updated").

---

## List tooling

Consistent UX on every list page (Projects, My Tasks, Contacts,
Organizations, Documents, Users):

- **Search + filter + sort** — a shared toolbar with search, multi-filter
  dropdowns, an active-filter chip row with one-click removal + Clear-all, and
  an explicit Sort dropdown. A result-count line ("12 of 27 match").
- **Cmd/Ctrl+K palette** — a global jump surface: search projects/tasks/
  contacts/orgs + quick actions (New project/task/contact), with **Starred**
  and **Recent** sections on the empty query. `↑↓` navigate, `↵` select, `Esc`
  close.
- **Star / pin** — star projects, contacts, and orgs; pin tasks. Flags are
  local to your browser and feed the Cmd+K Starred section.
- **Bulk actions** — multi-select + a floating action bar (Set status /
  Activate / Deactivate / Delete, per entity).
- **CSV export — scoped** — an Export CSV popover with date-range and
  status/type/role chips that scope the export without changing the list's
  filters; UTF-8 BOM (Excel-safe) + RFC-4180 quoting.

---

## Workspaces & multi-tenancy

Project Ops is **multi-tenant**: data is partitioned into **workspaces**, and
the boundary is enforced in the database with PostgreSQL **Row-Level
Security**. The runtime connects as a non-bypass role, so a workspace's rows
are provably invisible and unwritable from any other workspace.

**How it shows up.** Users land in their **default** workspace; a **workspace
switcher** in the dashboard chrome moves between the workspaces you're a member
of. Every project, task, comment, document, automation, webhook, custom field,
and approval is workspace-scoped. The recurring-task job, billing poller, and
automation engine each run **one scoped pass per workspace**, never across the
fence.

A workspace mirrors the suite's registry record (Project Ops never mints
workspace ids); members carry a workspace role (`VIEWER` < `MEMBER` <
`MANAGER` < `ADMIN` < `OWNER`) and a status (`ACTIVE` / `SUSPENDED` /
`REVOKED`).

---

## Roles & permissions

App access is **role-based** (`User.role`). The four roles and what each can
do:

| Role | Can do |
|---|---|
| **ADMIN** | Everything: all projects/tasks/CRM, all of the above admin surfaces (automations, webhooks, custom fields, capacity team view, profitability), user management. |
| **MANAGER** | Manage projects/tasks/CRM they can see; **automations, webhooks, capacity team view + editing capacities, and profitability/money reports**; approve timesheets. |
| **STAFF** | Work on projects/tasks they own or are assigned to; log time and submit timesheets; **request** client approvals; see their **own** capacity. No money reports, no automations/webhooks admin. |
| **CLIENT** | The client portal only: their own org's projects + shared documents, decide approvals, comment, view invoices (read-only). Cannot see cost/margin; **read-only** through the assistant/MCP. |

Role gating is consistent across the dashboard, the assistant, and the MCP/API
— a CLIENT asking the assistant "what projects do I have?" sees only their own,
and write tools refuse for that role.

**Sign-in.** SSO is via Keycloak (the `uchub` realm, Google + Microsoft
federation). First-time SSO users are provisioned **only** if they match the
`PROJECT_OPS_ACCESS_LIST` allowlist (`email-or-pattern:role`, resolved
exact → domain-wildcard → deny). The email+password form is retained for
client-portal users invited via a contact (who don't have Keycloak accounts).

---

## AI assistant, MCP & API

Every dashboard page has an **Ask** pill that opens a sidebar agent — the
**Project Ops Assistant** — with live, RBAC-scoped read + write access to your
data (it can list, drill in, create, update status, comment, and draft
reports). It can run as a full-height drawer or a popped corner widget, and
remembers preferences per user.

The assistant is powered by a **private, on-prem model** — a local **Qwen 3.6
35B** served through a **metered LLM gateway** — so prompts and data stay on
your own infrastructure rather than going to a third-party model. Its turns are
metered (tokens + cost) and surface in the [Agents
ledger](#agent-activity--usage).

The same surface is an **MCP server** any MCP-capable client (Claude Code,
Cursor, Continue, Zed, your own agent) can plug into, and direct API access is
available via **Personal Access Tokens** (Settings → API tokens) with scoped
permissions. Per-user identity propagates end-to-end, so a token/agent only
ever sees what its user's role allows.

- **End-user guide** → [`AI_ASSISTANT.md`](AI_ASSISTANT.md) (what to ask, how
  RBAC + memory work, prompting tips).
- **Wire up a coding agent / API** →
  [`MCP_FOR_CODING_AGENTS.md`](MCP_FOR_CODING_AGENTS.md) (tool list, token
  minting, per-client config).
