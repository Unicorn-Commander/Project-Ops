# Project Ops

Project management, task tracking, CRM, time & billing, recurring work, an
automation engine, outbound webhooks, portfolio reporting, capacity planning,
a two-way client portal, and a built-in AI agent — for teams who'd rather ship
than chase status updates.

Part of the [Unicorn Commander](https://unicorncommander.ai) suite, by
[Magic Unicorn](https://magicunicorn.dev).

Live: [projectops.magicunicorn.dev](https://projectops.magicunicorn.dev) ·
Features: [`docs/FEATURES.md`](docs/FEATURES.md) ·
Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## What's inside

The full, up-to-date tour lives in **[`docs/FEATURES.md`](docs/FEATURES.md)**.
The headline set:

- **Projects & tasks** — statuses, priorities, categories/tags, **subtasks**,
  and **task dependencies** (with cycle/duplicate/self-link guards).
- **Views** — Kanban board, a **Master schedule** (timeline with org/owner/
  status swimlanes + drag-to-reschedule), and a snapshot card on every project
  (completion %, status donut, priority bar).
- **Recurring tasks & projects** — a "Repeats" picker (Daily / Weekly /
  Monthly + every-N) backed by an `FREQ`/`INTERVAL` RRULE subset, materialized
  daily.
- **Custom fields** — per-workspace, per-entity fields (text / number / date /
  select / multi-select / boolean) under Settings → Custom fields.
- **Automations** — a When → If → Then rules engine over your activity, with a
  builder, conditions (`eq`/`neq`/`contains`/`gt`/`lt`), 5 action types, run
  counts, and a loop guard.
- **Webhooks** — per-workspace endpoints with HMAC-SHA256-signed deliveries
  (`X-ProjectOps-Signature`), show-once secrets, retries, and a delivery log.
- **Reporting** — Portfolio / Profitability / Throughput (money is
  manager-gated).
- **Capacity planning** — committed vs pro-rated weekly capacity, utilization
  bands, over-allocation + unestimated-task flags.
- **Time tracking & billing** — timers, manual entry, rate resolution,
  timesheets, and a billable rollup to Accounting-Ops.
- **Two-way client portal** — approvals (request / approve / reject / request
  changes), client comments, and read-only invoices with a pay deep-link
  (no in-app payment).
- **CRM** — organizations (parent/child hierarchy + rollups) and contacts.
- **Documents** — S3-compatible object store; attach to projects/tasks; print
  a project as a paper status report.
- **Collaboration** — notifications + @mentions, real-time WebSocket updates,
  threaded comments, and a unified activity feed.
- **List tooling** — shared search/filter/sort toolbars, a Cmd/Ctrl+K palette,
  star/pin, bulk actions, saved views, and scoped CSV export on every list.
- **AI assistant + MCP/API** — an embedded, RBAC-scoped sidebar agent plus an
  MCP server and Personal Access Tokens for any agent or client.
- **Multi-tenancy** — workspaces fenced in Postgres with Row-Level Security;
  roles (ADMIN / MANAGER / STAFF / CLIENT); SSO + a full audit trail.

## Keyboard shortcuts

| Shortcut | What |
|---|---|
| `⌘K` / `Ctrl+K` | Open the command palette |
| `⌘/` / `Ctrl+/` | Same — alternate binding |
| `↑` `↓` | Navigate palette results |
| `↵` | Select highlighted result |
| `Esc` | Close palette |

## Stack

- **Frontend**: Next.js 15, React 19, Tailwind 4, Radix
- **Backend**: NestJS 10, Prisma 5, PostgreSQL 17 with **Row-Level Security**
  for workspace tenancy (the runtime connects as a `NOBYPASSRLS` role)
- **Auth**: Keycloak (`uchub` realm) — SSO with Google + Microsoft federation
- **Storage**: S3-compatible — production uses [Garage](https://garagehq.deuxfleurs.fr/) (Rust-based, distributed); env vars are still named `MINIO_*` for back-compat
- **Cache**: Redis 7
- **Agent layer**: [Unicorn Brigade](https://brigade.magicunicorn.dev) (FastAPI + FalkorDB)
- **Schema**: source-of-truth in `backend/prisma/schema.prisma`, applied via `prisma db push` (no migration history)

## Deployment

| Instance | Domain | Purpose |
|---|---|---|
| MU/UC internal | `projectops.magicunicorn.dev` | Magic Unicorn / Unicorn Commander team work |

Federates to the Keycloak `uchub` realm at `auth.unicorncommander.ai`.
Deployment carries brand-specific logo, theme, landing copy, and Keycloak
client wired through `infrastructure/docker/.env`.

Compose lives at `infrastructure/docker/docker-compose.yml`; deployment is
`docker compose up -d --build` from that directory after a `git pull`.

## AI assistant + MCP server

Project Ops ships an in-dashboard sidebar agent (the "Ask" pill in the
top bar) that talks to the **Project Ops Assistant** in
[Unicorn Brigade](https://brigade.magicunicorn.dev). The assistant has
live read + write access to your projects, tasks, organizations,
contacts, documents, billing, and activity — through an MCP server
mounted on the backend at:

```
https://api.projectops.magicunicorn.dev/api/v1/mcp
```

Per-user identity propagates end-to-end: dashboard → Brigade →
short-lived per-user JWT → MCP server → Prisma `buildVisibilityFilter`.
A `CLIENT` user asking "what projects do I have?" sees only their own.

Any MCP-capable client (Claude Code, OpenCode, Cursor, Continue, Zed, or
your own agent) can plug into the same surface.

- **For end users** — [`docs/AI_ASSISTANT.md`](docs/AI_ASSISTANT.md):
  what to ask, how RBAC + memory work, prompting tips.
- **See it in action** —
  [`docs/AI_ASSISTANT_DEMO.md`](docs/AI_ASSISTANT_DEMO.md): verbatim
  transcript of the assistant doing real work (list, drill in,
  create, draft) against live production.
- **For developers wiring up a coding agent** —
  [`docs/MCP_FOR_CODING_AGENTS.md`](docs/MCP_FOR_CODING_AGENTS.md): full
  tool list, JWT minting, per-client config.

## Documentation

The full doc set is indexed in [`docs/README.md`](docs/README.md). Start here:

| Doc | What |
|---|---|
| [`docs/FEATURES.md`](docs/FEATURES.md) | The complete, user-facing feature guide (every area, how to use it, limits) |
| [`docs/AI_ASSISTANT.md`](docs/AI_ASSISTANT.md) | The in-app AI assistant — what to ask, RBAC + memory, tips |
| [`docs/MCP_FOR_CODING_AGENTS.md`](docs/MCP_FOR_CODING_AGENTS.md) | Wire a coding agent / API client into the MCP server |
| [`CHANGELOG.md`](CHANGELOG.md) | Per-release record of what shipped, changed, and got fixed |

## Local development

```bash
# 1. Infrastructure (Postgres + Redis + Garage)
cd infrastructure/docker
cp .env.example .env                                   # fill in real values
docker compose up -d project-ops-postgres project-ops-redis

# 2. Backend
cd ../../backend
cp .env.example .env                                   # fill in real values
npm install
npx prisma generate
npx prisma db push                                     # applies schema.prisma to the DB
npm run start:dev                                      # http://localhost:3201

# 3. Frontend
cd ../frontend
npm install
npm run dev                                            # http://localhost:3200
```

> Production uses `prisma db push` (schema is the source of truth, no
> migration history). If you need migration history, run
> `npx prisma migrate dev --name <change>` — but check with the
> maintainer first to avoid divergence between deployments.

## Production deployment

```bash
cd infrastructure/docker
cp .env.example .env  # set DOMAIN, API_DOMAIN, secrets, KEYCLOAK_CLIENT_SECRET
docker compose up -d --build
docker exec project-ops-backend npx prisma db push
```

Compose is host-portable — same file runs anywhere by changing
`${DOMAIN}` / `${API_DOMAIN}` / `${STORAGE_DOMAIN}` and the Keycloak
client secret in `.env`.

## SSO

The login page exposes a "Sign in with Unicorn Commander" button that
hits `/api/v1/auth/keycloak`, which redirects to the `uchub` realm and
returns the user to `/auth/sso-callback?token=…`.

First-time SSO users are JIT-provisioned only if they appear in the
**`PROJECT_OPS_ACCESS_LIST`** allowlist — an env var of comma-separated
`email-or-pattern:role` entries:

```
PROJECT_OPS_ACCESS_LIST="aaron@magicunicorn.tech:ADMIN, *@magicunicorn.tech:STAFF"
```

Resolution: exact match → domain wildcard → deny. Without the env var
set, the backend falls back to a hardcoded two-entry allowlist
(Aaron + Shafen as ADMIN) so the deploy boots into a working state on
day one. Production should always set the env var explicitly.

The email + password form on the login page is retained for
client-portal users invited via `/contacts/:id/invite` — those users
don't have Keycloak accounts.

## Releases

Versions follow [Semantic Versioning](https://semver.org/) and the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. See
[`CHANGELOG.md`](CHANGELOG.md) for what shipped, what changed, what got
fixed, and the infrastructure notes the operator cares about.

## License

Proprietary. © Magic Unicorn LLC. All rights reserved.
