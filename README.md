<div align="center">

<img src="docs/screenshots/crew.png" alt="Project Ops" width="190" />

# Project Ops

### Self-hosted project & operations management — with an AI agent that actually does the work.

**For teams who'd rather ship than chase status updates.**

[![Version](https://img.shields.io/badge/version-1.13.0-7c3aed?style=flat-square)](CHANGELOG.md)
[![Stack](https://img.shields.io/badge/NestJS_·_Next.js_15_·_Postgres_17-0ea5e9?style=flat-square)](#-architecture)
[![Tenancy](https://img.shields.io/badge/multi--tenant-Postgres_RLS-f59e0b?style=flat-square)](#-why-project-ops)
[![AI](https://img.shields.io/badge/AI-on--prem_·_MCP--native-22c55e?style=flat-square)](#-ai-assistant--mcp)
[![License](https://img.shields.io/badge/license-Apache_2.0-22c55e?style=flat-square)](LICENSE)

[**▶ Live**](https://projectops.unicorncommander.ai) · [**Features**](docs/FEATURES.md) · [**AI Assistant**](docs/AI_ASSISTANT.md) · [**MCP for agents**](docs/MCP_FOR_CODING_AGENTS.md) · [**Changelog**](CHANGELOG.md)

<sub>Part of the [Unicorn Commander](https://unicorncommander.ai) suite, by [Magic Unicorn](https://magicunicorn.dev).</sub>

</div>

---

Project Ops runs the whole operation of a working team in one app — projects, a CRM, time & billing, and automation — where **people and AI agents are both first-class citizens.** They share the same tasks, the same permission model, and the same audit trail, and hand work back and forth: you assign a task to an agent, an agent assigns one back to you or to another agent, and it all lands on the same board. **Self-hosted, on your own hardware, with your data staying inside your walls.**

## The problems it solves

**"Where do things stand?" shouldn't cost a meeting.** Status lives in people's heads, a spreadsheet, and three Slack threads — so every week starts with a round of "what's the latest on…". Project Ops puts every project, its status, and what's due on one dashboard and one master schedule. You already know before you ask.

**Your operation is scattered across five tools that don't talk to each other.** A PM tool _plus_ a time tracker _plus_ a CRM _plus_ a billing add-on _plus_ a pile of Zapier glue — five logins, five bills, five versions of the truth, and integrations that break silently. Project Ops is one app with **one permission model**, so a single automation can move a task, log the time, invoice it, and notify the client without ever crossing an API boundary.

**AI that can't touch your real data is a demo, not a tool.** Most "AI features" are a chat box that can't see your projects — or a SaaS assistant that reads your data by shipping it to someone else's cloud. Project Ops embeds an agent with **live, permission-scoped read _and write_** across your projects, tasks, CRM, and billing, and runs inference on **your own GPU**. A client asking "what's on my projects?" sees only theirs; your data never leaves the building. The same surface is exposed as an **MCP server**, so Claude Code, Cursor, or Zed operate the app exactly like a teammate would.

**Renting your own operations data back, per seat, forever.** SaaS charges you monthly, per person, to keep _your_ company's data on _their_ servers. Project Ops is self-hosted on hardware you control, with your own login (Keycloak) and S3-compatible storage you own — no seat tax, no lock-in, nothing to exfiltrate.

**"Multi-tenant" is usually one forgotten `WHERE` clause away from a leak.** Here isolation is enforced by the database itself — Postgres Row-Level Security with a `NOBYPASSRLS` runtime role — not by hoping every query remembered to filter. Roles, SSO, and a full audit trail come with it.

**Client updates turn into another email thread.** A built-in, scoped **client portal** lets a client approve work, comment, and see read-only invoices with a pay link — without an account on your internal tools and without seeing anyone else's data.

## ✨ How it does it

- **👥🤖 Humans and agents, both first-class.** People and AI agents share one system — the same RBAC, the same task board, the same audit trail. A human assigns a task to an agent; an agent assigns one back, or to another agent; every hand-off lands on the same schedule. The in-dashboard agent has live, **RBAC-scoped** read **and write** across projects, tasks, CRM, billing, and activity, and that exact surface is a full **MCP server** (Claude Code, Cursor, Zed, or your own agent). Inference runs **on-prem** (a local Qwen 3.6 35B), so your project data never leaves your walls.
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
- **Agents** — an activity & usage ledger: agent _events_ + token usage/cost, the agent analog of timesheets
- MCP surface for external coding agents

</td></tr>
</table>

The complete, user-facing tour lives in **[`docs/FEATURES.md`](docs/FEATURES.md)**.

## 🤖 AI assistant + MCP

Project Ops ships an in-dashboard sidebar agent — the **"Ask"** pill in the top bar — backed by the **Project Ops Assistant** in [Unicorn Brigade](https://brigade.magicunicorn.dev). It has live read + write across your projects, tasks, organizations, contacts, documents, billing, and activity, through an MCP server mounted on the backend:

```
https://api.projectops.unicorncommander.ai/api/v1/mcp
```

**Identity propagates end-to-end** — dashboard → Brigade → a short-lived per-user JWT → MCP server → Prisma `buildVisibilityFilter`. A `CLIENT` asking _"what projects do I have?"_ sees only their own. Inference is metered and runs on a local model, so prompts and project data stay on-prem.

Any MCP-capable client (Claude Code, OpenCode, Cursor, Continue, Zed, or your own agent) can plug into the same surface — see [`docs/MCP_FOR_CODING_AGENTS.md`](docs/MCP_FOR_CODING_AGENTS.md) for the tool list, JWT minting, and per-client config. For a verbatim transcript of the assistant doing real work against live production, see [`docs/AI_ASSISTANT_DEMO.md`](docs/AI_ASSISTANT_DEMO.md).

## 🏗️ Architecture

| Layer           | Tech                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**    | Next.js 15, React 19, Tailwind 4, Radix                                                                                      |
| **Backend**     | NestJS 10, Prisma 5, PostgreSQL 17 — **Row-Level Security** for workspace tenancy (runtime connects as a `NOBYPASSRLS` role) |
| **Auth**        | Local admin for self-host; optional Keycloak OIDC                                                                            |
| **Storage**     | S3-compatible — [Garage](https://garagehq.deuxfleurs.fr/) (Rust, distributed); env vars stay `MINIO_*` for back-compat       |
| **Cache**       | Redis 7                                                                                                                      |
| **Agent layer** | [Unicorn Brigade](https://brigade.magicunicorn.dev) (FastAPI) → metered on-prem LLM gateway                                  |
| **Schema**      | source-of-truth in `backend/prisma/schema.prisma`, applied via `prisma db push`                                              |

Health & diagnostics: `GET /api/v1/health` (liveness/readiness) and **`GET /api/v1/health/integrations`** — a one-glance operator report of DB / Keycloak / Brigade / registry / object-storage as `ok` / `down` / `not_configured`.

## 🌐 Deployments

| Instance           | Domain                                                                     | Purpose                                          |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------ |
| **Production**     | [`projectops.unicorncommander.ai`](https://projectops.unicorncommander.ai) | Customer-facing                                  |
| **MU/UC internal** | [`projectops.magicunicorn.dev`](https://projectops.magicunicorn.dev)       | Magic Unicorn / Unicorn Commander team (dogfood) |

These hosted deployments use separately managed identity and storage. The local
self-host profile below has its own generated admin and no hosted dependencies.

## ⚡ Quick start

Requires Git and Docker with Compose v2. Run from a new clone. The default is
**local admin authentication with optional OIDC**; no Keycloak account or client
is needed. API and UI ports bind only to `127.0.0.1`.

```bash
git clone https://github.com/Unicorn-Commander/project-ops-community.git
cd project-ops-community
cp .env.example .env
docker compose -f docker-compose.selfhost.yml up -d --build
curl --retry 60 --retry-delay 2 --retry-connrefused -fsS http://127.0.0.1:3201/api/v1/health/live
curl -fsS http://127.0.0.1:3201/api/v1/health/ready
# Run in an interactive terminal. Do not redirect, tee, or record this output.
docker compose -f docker-compose.selfhost.yml exec backend node dist/selfhost/bootstrap.js
```

The final command creates one local ADMIN, one workspace, and an active OWNER
membership. It displays a generated email, password, and bcrypt password hash
once. Save the email and password in your password manager, then open
[the sign-in page](http://127.0.0.1:3200/auth/login) and use the email/password
form. The generated `example.invalid` email is a login identifier, not a mailbox.
The password hash is for inspection; sign in with the password, not the hash.
You can change the password at `/auth/change-password` after signing in.

Repeating bootstrap does not reveal or reset credentials. It refuses to seed an
unrelated existing installation. Only the hash is stored in the database; no
admin password file is created and bootstrap does not run in container logs.
A terminal interruption after the transaction commits can lose the one-time
password display; recovery then requires a deliberate database-admin password
reset, not rerunning bootstrap.

The init service generates database passwords, `JWT_SECRET`, a persistent
`EMAIL_ENCRYPTION_KEY`, a workspace ID, and the local admin identity in the
`selfhost_config` Docker volume. Postgres and Redis also have named volumes and
no published ports. `.env` contains only the optional settings you choose and
is ignored by git. Back up the configuration and database volumes together;
removing the configuration volume alone loses encryption keys and DB access.
The image initializes the schema with this repo's `prisma db push` workflow;
it does not run the historical dogfood SQL seeds or accept destructive schema
changes automatically.

This profile is for **one workspace on one machine**. It uses a non-superuser
runtime database role, but does not install the hosted multi-workspace RLS
policies (`PROJECT_OPS_TENANCY_ENABLED=false`). Do not use it for tenants that
need isolation. Hosted tenancy setup remains a separate deployment path.

Projects, tasks, the dashboard, and local sign-in do not require object storage.
Attachments need an S3-compatible service configured with the `MINIO_*` values
in `.env.example`, including a browser-reachable public endpoint. Without one,
storage initialization/integration checks report unavailable; liveness and DB
readiness remain usable. Email delivery, AI/Brigade, and registry integration
also require separate configuration and are not part of this quickstart.

## 🔐 Optional OIDC + agent access

Local password sign-in remains available. To add OIDC using your own Keycloak,
set `PROJECT_OPS_AUTH_MODE=oidc`, `KEYCLOAK_URL`, `KEYCLOAK_REALM`,
`KEYCLOAK_CLIENT_ID`, and `KEYCLOAK_CLIENT_SECRET` in the root `.env`. Register
`http://127.0.0.1:3201/api/v1/auth/keycloak/callback` as the client redirect URI,
then rerun the compose build/up command to enable the SSO button.
Set the first-login allowlist explicitly, for example:

```dotenv
PROJECT_OPS_ACCESS_LIST=owner@example.com:ADMIN,*@example.com:STAFF
```

Exact email rules precede domain rules; unmatched users are denied. The old
personal-address fallback has been removed. With no explicit list, the self-host
entrypoint substitutes only the generated bootstrap identity. Elsewhere, a
missing list grants no first-login access.

After local sign-in, mint a scoped, expiring `po_pat_` through
`POST http://127.0.0.1:3201/api/v1/auth/pats`. See
[the localhost MCP guide](docs/MCP_FOR_CODING_AGENTS.md) for a terminal recipe
that reads your password privately and keeps the session token in memory.

## ⌨️ Keyboard shortcuts

| Shortcut              | What                      |
| --------------------- | ------------------------- |
| `⌘K` / `Ctrl+K`       | Command palette           |
| `⌘/` / `Ctrl+/`       | Same — alternate binding  |
| `↑` `↓` · `↵` · `Esc` | Navigate · select · close |

## 📚 Documentation

The full set is indexed in [`docs/README.md`](docs/README.md).

### Rate limiting

The backend keeps the `short`, `long`, and `mcp` throttling tiers. Authenticated
requests are bucketed by the verified PAT id or JWT user/Keycloak subject;
unauthenticated requests use `CF-Connecting-IP` or the first
`X-Forwarded-For` value only when the immediate peer is a trusted proxy.

`TRUSTED_PROXY_CIDRS` optionally overrides the default private/Docker and
loopback proxy ranges with a comma-separated CIDR list. Do not set it to an
unbounded range: forwarded headers from an untrusted peer are ignored.

| Doc                                                              | What                                                       |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| [`docs/FEATURES.md`](docs/FEATURES.md)                           | The complete, user-facing feature guide                    |
| [`docs/AI_ASSISTANT.md`](docs/AI_ASSISTANT.md)                   | The in-app assistant — what to ask, RBAC + memory, tips    |
| [`docs/AI_ASSISTANT_DEMO.md`](docs/AI_ASSISTANT_DEMO.md)         | A verbatim transcript of the assistant doing real work     |
| [`docs/MCP_FOR_CODING_AGENTS.md`](docs/MCP_FOR_CODING_AGENTS.md) | Wire a coding agent / API client into the MCP server       |
| [`CHANGELOG.md`](CHANGELOG.md)                                   | Per-release record of what shipped, changed, and got fixed |

## 📦 Releases

Versions follow [Semantic Versioning](https://semver.org/) and the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. See [`CHANGELOG.md`](CHANGELOG.md).

## ⚖️ License

**[Apache License 2.0](LICENSE)** — permissive, with an explicit patent grant. Use it, self-host it, fork it, build on it (commercially or not); just keep the notices. Provided as-is, no warranty.

© 2026 Magic Unicorn Unconventional Technology & Stuff Inc.

> The **code** is open (Apache-2.0). The **hosted** instance at [projectops.unicorncommander.ai](https://projectops.unicorncommander.ai) is a paid, managed service — the hosting, support, and integration with the broader Unicorn Commander suite are the product.
