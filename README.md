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

Project Ops is the operational backbone for a working team: **projects, tasks, a CRM, time & billing, recurring work, an automation engine, webhooks, portfolio reporting, capacity planning, a two-way client portal — and an embedded AI agent that can read and write all of it.** One app, self-hosted, your data on your hardware.

## ✨ Why Project Ops

- **🤖 AI-native, not AI-bolted-on.** An in-dashboard agent with live, **RBAC-scoped** read **and write** across your projects, tasks, CRM, billing, and activity — plus a full **MCP server** so Claude Code, Cursor, Zed, or your own agent plugs into the exact same surface. Inference runs **on-prem** (a local Qwen 3.6 35B), so your project data never leaves your walls.
- **🔐 Multi-tenancy the database enforces.** Workspaces fenced in Postgres with **Row-Level Security** — the runtime connects as a `NOBYPASSRLS` role, so isolation is guaranteed by the engine, not hopeful `WHERE` clauses. Roles: ADMIN / MANAGER / STAFF / CLIENT, SSO, and a full audit trail.
- **🏠 Sovereign by default.** Self-hosted, S3-compatible object storage ([Garage](https://garagehq.deuxfleurs.fr/)), your own Keycloak realm. No per-seat SaaS tax, no data exfiltration.
- **🧰 The whole operation, one permission model.** Stop stitching a PM tool + a time tracker + a CRM + a billing add-on. It's one coherent app — so an automation can move a task, log time, and notify a client without crossing a single API boundary.

## 📸 See it in action

> **[▶ Try the live instance →](https://projectops.unicorncommander.ai)**  ·  full gallery in [`docs/screenshots/`](docs/screenshots/)

**Dashboard** — everything across your projects at a glance: live stat cards, a project-status donut, priority distribution, your tasks, and top clients.

[![Dashboard](docs/screenshots/dashboard.png)](https://projectops.unicorncommander.ai/dashboard)

**Master Schedule** — every project on one timeline, grouped into customer / owner / status swimlanes, with live progress bars, due-date diamonds, and drag-to-reschedule.

[![Master Schedule](docs/screenshots/master-schedule.png)](https://projectops.unicorncommander.ai/dashboard/schedule)

**The "Ask" assistant** — ask in plain language; it answers (and acts) against your live data, scoped to exactly what you're allowed to see.

[![AI Assistant](docs/screenshots/assistant.png)](docs/AI_ASSISTANT.md)

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
