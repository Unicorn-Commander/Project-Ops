# Project Ops

Project management, task tracking, CRM, billing, and a built-in AI agent
— for teams who'd rather ship than chase status updates.

Part of the [Unicorn Commander](https://unicorncommander.ai) suite, by
[Magic Unicorn](https://magicunicorn.dev).

Live: [projectops.magicunicorn.dev](https://projectops.magicunicorn.dev) ·
Changelog: [`CHANGELOG.md`](CHANGELOG.md)

## What's inside

- **Projects & tasks** — status, priority, deadlines, owners; kanban,
  list, and Gantt views. **Drag-to-reschedule** on the Gantt; click-
  the-stat-card or use the toolbar to filter; sort by 6+ fields.
- **List toolbars everywhere** — every list page (Projects, My Tasks,
  Contacts, Organisations, Documents, Users) shares the same UX:
  search, multi-filter dropdowns with active-chip row, Clear-all, and
  an explicit Sort dropdown. Per-project colour stripes carry across
  every surface so a long list reads as more than rows.
- **Project snapshot card** — `/dashboard/projects/[id]` opens with
  completion %, status donut, priority bar, and Total/Completed/Overdue
  quick stats above the task list.
- **Cmd/Ctrl+K palette** — global jump surface. Search projects, tasks,
  contacts, organisations + quick actions (New project / task /
  contact). Keyboard-first: ↑↓ navigate, ↵ select, Esc close.
- **Organizations & contacts** — real CRM with parent/child org hierarchy and per-org rollups.
- **Billing** — invoice number, amount, payment status, due/paid dates, billing notes — on the project itself.
- **Client portal** — `CLIENT` role users see only their own organization's projects + shared documents.
- **Documents** — S3-compatible object store; attach to projects or tasks; share with the right people.
- **AI assistant** — embedded sidebar agent (Unicorn Brigade) with live read + write access to your data via MCP, scoped per-user.
- **Real-time collaboration** — WebSocket updates so every tab catches up live.
- **Activity & comments** — threaded comments on projects and tasks plus a unified activity feed.
- **SSO + audit trail** — Keycloak (`uchub` realm) with Google + Microsoft federation; every change logged.

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
- **Backend**: NestJS 10, Prisma 5, PostgreSQL 17
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
The deployment branch is `deploy/magicunicorn-projectops` (carries the
brand-specific logo, theme, landing copy, and Keycloak client). `main`
stays generic — never deploy from `main` directly.

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
set, only the bootstrap admins from `INITIAL_ADMIN_EMAILS` are admitted.
This stops every `uchub` realm user from auto-creating a Project-Ops
account on their first sign-in.

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
