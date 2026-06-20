# Screenshots

Brand art (`crew.png`, `crew-dark.png`) ships here. The product screenshots below
are referenced by the root `README.md`; drop the PNGs in with the **exact
filenames** and they light up automatically.

> Capture from the live dogfood (`https://projectops.magicunicorn.dev`) signed in,
> at a ~1440-wide viewport, dark theme. Each was verified looking great on
> 2026-06-20; this just needs a session with browser **file** access to save them.

| Filename | Screen | Route | What it shows |
|---|---|---|---|
| `dashboard.png` | Dashboard | `/dashboard` | Stat cards (total/active/completed/due), project-status donut, priority distribution, My Tasks, Top Clients |
| `master-schedule.png` | Master Schedule | `/dashboard/schedule` | Portfolio Gantt: customer/owner/status swimlanes, live progress bars, TODAY marker, drag-to-reschedule |
| `kanban.png` | Kanban Board | `/dashboard/kanban` | Drag-and-drop board across statuses |
| `assistant.png` | AI Assistant | any page → **Ask** pill | The RBAC-scoped sidebar agent answering against live data |
| `time-billing.png` | Time & Billing | `/dashboard/timesheets` | Timers, entries, timesheet approval, billable rollup |
| `agents.png` | Agents | `/dashboard/agents` | Agent activity & usage ledger — events + token usage/cost |

Naming: lowercase, hyphenated, `.png`. Keep them under ~1 MB each (optimize if needed).
