# Screenshots

Brand art (`crew.png`, `crew-dark.png`) plus the product screenshots referenced by
the root `README.md`. Captured from the live app at 4K, resized to 2400px wide.
Dark theme unless the filename says `-light`.

To refresh a shot: capture the screen, drop the PNG in with the **exact filename**
below, and (optionally) `sips --resampleWidth 2400 <file>.png` to keep it light.
The root README picks them up automatically.

## Featured in the root README

| Filename | Screen | Route | What it shows |
|---|---|---|---|
| `dashboard.png` | Dashboard | `/dashboard` | Stat cards, project-status donut, priority distribution, My Tasks, Top Clients |
| `dashboard-light.png` | Dashboard (light) | `/dashboard` | Same, light theme — used for the light/dark showcase |
| `master-schedule.png` | Master Schedule | `/dashboard/schedule` | Portfolio Gantt: customer/owner/status swimlanes, live progress bars, TODAY marker |
| `assistant.png` | AI Assistant | any page → **Ask** pill | The RBAC-scoped sidebar agent over live data |
| `kanban.png` | Kanban Board | `/dashboard/kanban` | Drag-and-drop board across statuses, with filters |
| `my-tasks.png` | My Tasks | `/dashboard/my-tasks` | Everything assigned to you, sorted by due date, overdue banner |
| `reports.png` | Reports | `/dashboard/reports` | Portfolio / Profitability / Throughput + project-health table |
| `capacity.png` | Capacity | `/dashboard/capacity` | Committed hours vs capacity, team workload, over-allocation |
| `triage.png` | Triage | `/dashboard/triage` | AI-proposed action items awaiting human approval |
| `agents.png` | Agents | `/dashboard/agents` | Agent activity & usage ledger — events + token usage/cost |
| `documents-viewer.png` | Documents | `/dashboard/documents` | Document store + in-app markdown viewer (full-height) |
| `billing.png` | Billing | `/dashboard/billing` | Ready-to-bill rollup + draft invoices |

## Also available (in this folder, not embedded)

| Filename | Screen |
|---|---|
| `projects.png` | Projects list (status tabs, filters, saved views) |
| `documents.png` | Documents list (stat cards + color-coded rows) |
| `timesheets.png` | Timesheets (weekly grid + submit for approval) |
| `time-billing.png` | Billing (alias used by an older README slot) |
| `utilization.png` | Utilization (billable %, realization, hours by project) |
| `automations.png` | Automations (When → If → Then rules + templates) |
| `users.png` | User Management (SSO-federated roles) |
| `settings.png` | Settings (profile, security, workspaces) |

Naming: lowercase, hyphenated, `.png`. Keep them under ~1 MB each.
