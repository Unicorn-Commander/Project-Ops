<div align="center">

<img src="docs/screenshots/crew.png" alt="Project Ops" width="190" />

# Project Ops

### Self-hosted project & operations management — with an AI agent that actually does the work.

**For teams who'd rather ship than chase status updates.**

[![Version](https://img.shields.io/badge/version-1.13.0-7c3aed?style=flat-square)](CHANGELOG.md)
[![Stack](https://img.shields.io/badge/NestJS_·_Next.js_15_·_Postgres_17-0ea5e9?style=flat-square)](#-architecture)
[![Tenancy](https://img.shields.io/badge/multi--tenant-Postgres_RLS-f59e0b?style=flat-square)](#-why-project-ops)
[![AI](https://img.shields.io/badge/AI-on--prem_·_MCP--native-22c55e?style=flat-square)](#-ai-assistant--mcp)
[![License](https://img.shields.io/badge/license-proprietary-64748b?style=flat-square)](#-license)

[**▶ Live**](https://projectops.unicorncommander.ai) · [**Features**](docs/FEATURES.md) · [**AI Assistant**](docs/AI_ASSISTANT.md) · [**MCP for agents**](docs/MCP_FOR_CODING_AGENTS.md) · [**Changelog**](CHANGELOG.md)

<sub>Part of the [Unicorn Commander](https://unicorncommander.ai) suite, by [Magic Unicorn](https://magicunicorn.dev).</sub>

</div>

---

Project Ops runs the whole operation of a working team in one app — projects, a CRM, time & billing, automation, and an AI agent that can actually do the work — **self-hosted, on your own hardware, with your data staying inside your walls.**

## The problems it solves

**"Where do things stand?" shouldn't cost a meeting.** Status lives in people's heads, a spreadsheet, and three Slack threads — so every week starts with a round of "what's the latest on…". Project Ops puts every project, its status, and what's due on one dashboard and one master schedule. You already know before you ask.

**Your operation is scattered across five tools that don't talk to each other.** A PM tool *plus* a time tracker *plus* a CRM *plus* a billing add-on *plus* a pile of Zapier glue — five logins, five bills, five versions of the truth, and integrations that break silently. Project Ops is one app with **one permission model**, so a single automation can move a task, log the time, invoice it, and notify the client without ever crossing an API boundary.

**AI that can't touch your real data is a demo, not a tool.** Most "AI features" are a chat box that can't see your projects — or a SaaS assistant that reads your data by shipping it to someone else's cloud. Project Ops embeds an agent with **live, permission-scoped read *and write*** across your projects, tasks, CRM, and billing, and runs inference on **your own GPU**. A client asking "what's on my projects?" sees only theirs; your data never leaves the building. The same surface is exposed as an **MCP server**, so Claude Code, Cursor, or Zed operate the app exactly like a teammate would.

**Renting your own operations data back, per seat, forever.** SaaS charges you monthly, per person, to keep *your* company's data on *their* servers. Project Ops is self-hosted on hardware you control, with your own login (Keycloak) and S3-compatible storage you own — no seat tax, no lock-in, nothing to exfiltrate.

**"Multi-tenant" is usually one forgotten `WHERE` clause away from a leak.** Here isolation is enforced by the database itself — Postgres Row-Level Security with a `NOBYPASSRLS` runtime role — not by hoping every query remembered to filter. Roles, SSO, and a full audit trail come with it.

**Client updates turn into another email thread.** A built-in, scoped **client portal** lets a client approve work, comment, and see read-only invoices with a pay link — without an account on your internal tools and without seeing anyone else's data.

## ✨ How it does it

- **🤖 AI-native, not AI-bolted-on.** An in-dashboard agent with live, **RBAC-scoped** read **and write** across your projects, tasks, CRM, billing, and activity — plus a full **MCP server** so Claude Code, Cursor, Zed, or your own agent plugs into the exact same surface. Inference runs **on-prem** (a local Qwen 3.6 35B), so your project data never leaves your walls.
- **🔐 Multi-tenancy the database enforces.** Workspaces fenced in Postgres with **Row-Level Security** — the runtime connects as a `NOBYPASSRLS` role, so isolation is guaranteed by the engine, not hopeful `WHERE` clauses. Roles: ADMIN / MANAGER / STAFF / CLIENT, SSO, and a full audit trail.
- **🏠 Sovereign by default.** Self-hosted, S3-compatible object storage ([Garage](https://garagehq.deuxfleurs.fr/)), your own Keycloak realm. No per-seat SaaS tax, no data exfiltration.
- **🧰 The whole operation, one permission model.** Stop stitching a PM tool + a time tracker + a CRM + a billing add-on. It's one coherent app — so an automation can move a task, log time, and notify a client without crossing a single API boundary.

## 📸 See it in action

> **[▶ Try the live instance →](https://projectops.unicorncommander.ai)**

[![Project Ops dashboard](docs/screenshots/dashboard.png)](https://projectops.unicorncommander.ai/dashboard)

**📊 Dashboard** — everything across your projects at a glance: live stat cards, a project-status donut, priority distribution, your tasks, and top clients.
&nbsp; · &nbsp; [**▶ view live**](https://projectops.unicorncommander.ai/dashboard)

---

[![Master Schedule](docs/screenshots/master-schedule.png)](https://projectops.unicorncommander.ai/dashboard/schedule)

**🗓️ Master Schedule** — every project on one timeline, grouped into customer / owner / status swimlanes, with live progress bars, due-date diamonds, and drag-to-reschedule. No more "where does everything stand?" standup.

---

[![The Ask assistant](docs/screenshots/assistant.png)](docs/AI_ASSISTANT.md)

**🤖 The "Ask" assistant** — ask in plain language; it answers **and acts** against your live data, scoped by RBAC to exactly what you're allowed to see. Inference runs on-prem, so nothing leaves your walls. &nbsp; · &nbsp; [**read more**](docs/AI_ASSISTANT.md)

---

<table>
<tr>
<td width="50%" valign="top">

[![Kanban board](docs/screenshots/kanban.png)](https://projectops.unicorncommander.ai/dashboard/kanban)

**🗂️ Kanban** — drag tasks across statuses; filter by org, project, assignee, priority.

</td>
<td width="50%" valign="top">

[![My Tasks](docs/screenshots/my-tasks.png)](https://projectops.unicorncommander.ai/dashboard/my-tasks)

**✅ My Tasks** — everything on your plate, sorted by due date, with overdue front-and-center.

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![Reports](docs/screenshots/reports.png)](https://projectops.unicorncommander.ai/dashboard/reports)

**📈 Reports** — Portfolio health, Profitability, and Throughput across every project.

</td>
<td width="50%" valign="top">

[![Capacity planning](docs/screenshots/capacity.png)](https://projectops.unicorncommander.ai/dashboard/capacity)

**⚖️ Capacity** — who's over-committed and who has headroom, committed hours vs capacity.

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![Triage](docs/screenshots/triage.png)](https://projectops.unicorncommander.ai/dashboard/triage)

**🧭 Triage** — AI-proposed action items wait here; nothing becomes a task until you approve it.

</td>
<td width="50%" valign="top">

[![Agent activity ledger](docs/screenshots/agents.png)](https://projectops.unicorncommander.ai/dashboard/agents)

**🤖 Agents** — a ledger of what every AI agent did, and what it cost.

</td>
</tr>
<tr>
<td width="50%" valign="top">

[![Documents with live markdown viewer](docs/screenshots/documents-viewer.png)](https://projectops.unicorncommander.ai/dashboard/documents)

**📄 Documents** — S3-backed store with an in-app markdown viewer; attach to projects/tasks.

</td>
<td width="50%" valign="top">

[![Billing](docs/screenshots/billing.png)](https://projectops.unicorncommander.ai/dashboard/billing)

**💵 Billing** — roll approved billable time into draft invoices and track their status.

</td>
</tr>
</table>

> 🌗 **Light or dark, your call** — every screen ships both themes.
> <br><img src="docs/screenshots/dashboard-light.png" alt="Dashboard in light theme" width="49%" /> <img src="docs/screenshots/dashboard.png" alt="Dashboard in dark theme" width="49%" />

<sub>More screens — Projects, Time entries, Timesheets, Utilization, Automations, Users, Settings — live in [`docs/screenshots/`](docs/screenshots/).</sub>

## 🚀 Features

<table>
<tr><td width="33%" valign="top">

**📋 Plan & track**
- Projects & tasks — status, priority, categories/tags
- **Subtasks** + **task dependencies** (cycle/self-link guards)
- **Recurring** tasks & projects (RRULE subset, materialized daily)
- Per-workspace **custom fields** (text/number/date/select/boolean)

</td><td width="33%" valign="top">

**📊 Visualize**
- **Kanban board** (drag-and-drop)
- **Master schedule** — portfolio timeline + swimlanes
- Snapshot card per project (completion %, status donut)
- **Reports** — Portfolio / Profitability / Throughput
- **Capacity planning** — committed vs pro-rated, utilization bands

</td><td width="33%" valign="top">

**⏱️ Time & money**
- Timers + manual entry, rate resolution
- **Timesheets** with approval flow
- **Billable rollup** to Accounting-Ops
- **Client portal** — approvals, comments, read-only invoices + pay deep-link

</td></tr>
<tr><td width="33%" valign="top">

**⚙️ Automate & integrate**
- **Automations** — When → If → Then rules engine
- **Webhooks** — HMAC-SHA256-signed deliveries, retries, delivery log
- **MCP server** + Personal Access Tokens for any agent/client

</td><td width="33%" valign="top">

**🏢 Operate**
- **CRM** — organizations (parent/child + rollups) & contacts
- **Documents** — S3 store; attach to projects/tasks; print a status report
- Notifications, **@mentions**, real-time WebSocket updates, activity feed
- ⌘K palette, saved views, star/pin, bulk actions, scoped CSV export

</td><td width="33%" valign="top">

**🤖 AI & agents**
- Embedded **"Ask" assistant** (RBAC-scoped, read + write)
- **Agents** — an activity & usage ledger: agent *events* + token usage/cost, the agent analog of timesheets
- MCP surface for external coding agents

</td></tr>
</table>

The complete, user-facing tour lives in **[`docs/FEATURES.md`](docs/FEATURES.md)**.

## 🤖 AI assistant + MCP

Project Ops ships an in-dashboard sidebar agent — the **"Ask"** pill in the top bar — backed by the **Project Ops Assistant** in [Unicorn Brigade](https://brigade.magicunicorn.dev). It has live read + write across your projects, tasks, organizations, contacts, documents, billing, and activity, through an MCP server mounted on the backend:

```
https://api.projectops.unicorncommander.ai/api/v1/mcp
```

**Identity propagates end-to-end** — dashboard → Brigade → a short-lived per-user JWT → MCP server → Prisma `buildVisibilityFilter`. A `CLIENT` asking *"what projects do I have?"* sees only their own. Inference is metered and runs on a local model, so prompts and project data stay on-prem.

Any MCP-capable client (Claude Code, OpenCode, Cursor, Continue, Zed, or your own agent) can plug into the same surface — see [`docs/MCP_FOR_CODING_AGENTS.md`](docs/MCP_FOR_CODING_AGENTS.md) for the tool list, JWT minting, and per-client config. For a verbatim transcript of the assistant doing real work against live production, see [`docs/AI_ASSISTANT_DEMO.md`](docs/AI_ASSISTANT_DEMO.md).

## 🏗️ Architecture

| Layer | Tech |
|---|---|
| **Frontend** | Next.js 15, React 19, Tailwind 4, Radix |
| **Backend** | NestJS 10, Prisma 5, PostgreSQL 17 — **Row-Level Security** for workspace tenancy (runtime connects as a `NOBYPASSRLS` role) |
| **Auth** | Keycloak (`uchub` realm) — SSO with Google + Microsoft federation |
| **Storage** | S3-compatible — [Garage](https://garagehq.deuxfleurs.fr/) (Rust, distributed); env vars stay `MINIO_*` for back-compat |
| **Cache** | Redis 7 |
| **Agent layer** | [Unicorn Brigade](https://brigade.magicunicorn.dev) (FastAPI) → metered on-prem LLM gateway |
| **Schema** | source-of-truth in `backend/prisma/schema.prisma`, applied via `prisma db push` |

Health & diagnostics: `GET /api/v1/health` (liveness/readiness) and **`GET /api/v1/health/integrations`** — a one-glance operator report of DB / Keycloak / Brigade / registry / object-storage as `ok` / `down` / `not_configured`.

## 🌐 Deployments

| Instance | Domain | Purpose |
|---|---|---|
| **Production** | [`projectops.unicorncommander.ai`](https://projectops.unicorncommander.ai) | Customer-facing |
| **MU/UC internal** | [`projectops.magicunicorn.dev`](https://projectops.magicunicorn.dev) | Magic Unicorn / Unicorn Commander team (dogfood) |

Both federate to the Keycloak `uchub` realm at `auth.unicorncommander.ai`. Each deployment carries brand-specific logo, theme, landing copy, and Keycloak client, wired through `infrastructure/docker/.env` — the same compose runs anywhere by changing `${DOMAIN}` / `${API_DOMAIN}` / `${STORAGE_DOMAIN}` and the client secret.

## ⚡ Quick start

```bash
# 1. Infrastructure (Postgres + Redis + Garage)
cd infrastructure/docker
cp .env.example .env                 # fill in real values
docker compose up -d project-ops-postgres project-ops-redis

# 2. Backend
cd ../../backend
cp .env.example .env                 # fill in real values
npm install
npx prisma generate
npx prisma db push                   # applies schema.prisma to the DB
npm run start:dev                    # http://localhost:3201

# 3. Frontend
cd ../frontend
npm install
npm run dev                          # http://localhost:3200
```

> Schema is the source of truth (`prisma db push`, no migration history). Need
> migration history? Run `npx prisma migrate dev --name <change>` — but check
> with the maintainer first to avoid divergence between deployments.

## 🚢 Production deployment

```bash
cd infrastructure/docker
cp .env.example .env   # set DOMAIN, API_DOMAIN, STORAGE_DOMAIN, secrets, KEYCLOAK_CLIENT_SECRET
docker compose up -d --build
docker exec project-ops-backend npx prisma db push
```

`EMAIL_ENCRYPTION_KEY` (a 64-char hex, `openssl rand -hex 32`) is **required in production** — the backend refuses to boot without it.

## 🔐 SSO + access

The login page exposes a **"Sign in with Unicorn Commander"** button that hits `/api/v1/auth/keycloak`, redirects to the `uchub` realm, and returns the user to `/auth/sso-callback?token=…`.

First-time SSO users are JIT-provisioned only if they match **`PROJECT_OPS_ACCESS_LIST`** — comma-separated `email-or-pattern:role` entries:

```
PROJECT_OPS_ACCESS_LIST="aaron@magicunicorn.tech:ADMIN, *@magicunicorn.tech:STAFF"
```

Resolution is exact-match → domain-wildcard → deny. The email + password form is retained for **client-portal** users invited via `/contacts/:id/invite` (who don't have Keycloak accounts).

## ⌨️ Keyboard shortcuts

| Shortcut | What |
|---|---|
| `⌘K` / `Ctrl+K` | Command palette |
| `⌘/` / `Ctrl+/` | Same — alternate binding |
| `↑` `↓` · `↵` · `Esc` | Navigate · select · close |

## 📚 Documentation

The full set is indexed in [`docs/README.md`](docs/README.md).

| Doc | What |
|---|---|
| [`docs/FEATURES.md`](docs/FEATURES.md) | The complete, user-facing feature guide |
| [`docs/AI_ASSISTANT.md`](docs/AI_ASSISTANT.md) | The in-app assistant — what to ask, RBAC + memory, tips |
| [`docs/AI_ASSISTANT_DEMO.md`](docs/AI_ASSISTANT_DEMO.md) | A verbatim transcript of the assistant doing real work |
| [`docs/MCP_FOR_CODING_AGENTS.md`](docs/MCP_FOR_CODING_AGENTS.md) | Wire a coding agent / API client into the MCP server |
| [`CHANGELOG.md`](CHANGELOG.md) | Per-release record of what shipped, changed, and got fixed |

## 📦 Releases

Versions follow [Semantic Versioning](https://semver.org/) and the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. See [`CHANGELOG.md`](CHANGELOG.md).

## ⚖️ License

Proprietary. © Magic Unicorn LLC. All rights reserved.
