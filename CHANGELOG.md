# Changelog

All notable changes to Project Ops live here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.3] — 2026-04-30

### Fixed

- **Brigade ↔ Project-Ops MCP wiring (P1).** The Brigade compose was
  missing `PROJECTOPS_MCP_URL` / `PROJECTOPS_MCP_TOKEN` /
  `PROJECTOPS_JWT_SECRET` — the values sat in `.env` but never made
  it into the container. As a result, the in-app assistant could only
  answer in generalities and would tell users it had a "configuration
  error" when asked about their projects. Now wired through. Verified
  end-to-end with a live transcript captured in
  `docs/AI_ASSISTANT_DEMO.md`.
- **`JWT_SECRET` brittle multi-line value retired.** The Project-Ops
  backend was running with a `JWT_SECRET` that contained a literal
  newline + `O` — a documented gotcha that broke any caller hand-copying
  the value (notably, env propagation into Brigade). Rotated to a clean
  single-line 96-char hex secret, minted a new long-lived service-account
  token (`exp=2036`) for Brigade's MCP fallback, and replaced both the
  service token and the env wiring in one pass. In-flight Aaron+Shafen
  sessions invalidated by the rotation; both signed back in.

### Added

- **`docs/AI_ASSISTANT_DEMO.md`** — verbatim transcript of an actual
  session captured at v1.6.3 release: list visible projects, drill into
  P-00001, search by title, create a task (write tool — DB-confirmed),
  recent activity across projects, draft a status update. Includes
  what's working end-to-end (per-user JWTs, native local tool calling
  on Gemma 4 26B-a4b, audit trail), and what isn't (memory recall is
  currently empty — regression worth investigating).

## [1.6.2] — 2026-04-30

### Added

- **`docs/AI_ASSISTANT.md`** — user-facing walkthrough of the in-app
  Brigade agent: example prompts (read / plan / update / draft / use
  memory), how RBAC + memory work, prompting tips, what's underneath,
  privacy + audit, known limits. Linked from README beside the
  developer-facing `MCP_FOR_CODING_AGENTS.md`.
- **Targeted backend tests on the load-bearing RBAC surfaces** (12
  specs, `mcp.tools.spec.ts` + `jwt.strategy.spec.ts`):
  - `buildVisibilityFilter` returns no scope for ADMIN + MANAGER,
    owner-or-assignee scope for STAFF, contact-only scope for CLIENT,
    and the STAFF/CLIENT shapes are kept distinct so a future collapse
    can't silently widen access.
  - `ProjectOpsTools.assertCanWrite` allows ADMIN/MANAGER/STAFF and
    rejects CLIENT.
  - `JwtStrategy.validate` returns the resolved User on a valid
    payload, and translates *any* failure (auth-thrown
    `UnauthorizedException` or unexpected `Error`) into a 401 — so a
    DB blip can never leak a 500 with an internal stack trace.

### Changed

- `buildVisibilityFilter` and `ProjectOpsTools.assertCanWrite` exposed
  for testing — same runtime behaviour, no functional change.

## [1.6.1] — 2026-04-30

### Documentation

- **README refreshed** to match the v1.6 product. Drops the
  hypothetical GFL deployment row, calls Garage S3 by name (env vars
  still `MINIO_*` for back-compat), adds dedicated **What's inside**
  and **AI assistant + MCP server** sections, and links the live site +
  CHANGELOG. The agent surface is the differentiator — the README
  wasn't mentioning it at all.

## [1.6.0] — 2026-04-30

### Added

- **Landing-page FAQ.** Eight honest questions ("Can I self-host it?",
  "Does the AI agent need to be on?", "What stack is it built on?", …)
  rendered as native `<details>` so the section is zero-JS, accessible,
  keyboard-friendly, and prints clean. Chevron rotates on open via
  `[&[open]>summary>svg]:rotate-180`.
- **Footer link to the live CHANGELOG** on Forgejo (and to the repo
  source). The CHANGELOG was already shipping as the source of truth —
  this just makes it discoverable from the marketing surface.

### Changed

- **Smooth in-page scrolling** for hash-anchor navigation, with
  `scroll-padding-top: 5rem` so the sticky nav doesn't crop section
  headings. Respects `prefers-reduced-motion`.
- **Nav** picks up an FAQ link beside Features + How it works.

## [1.5.0] — 2026-04-30

### Changed

- **Toast variants** rebuilt around an inset 3px tinted left-edge stripe
  (box-shadow inset) instead of full-card tinting. Now ships `default`,
  `success`, `warning`, `destructive` — they read as the right severity
  without taking over the surface. Close + action buttons stay neutral.
- **Avatars on Users + Contacts list pages.** Both now use the shared
  `Avatar` primitive (deterministic gradient by name) so the same person
  shows the same colour everywhere — dashboard dropdown, kanban,
  task cards, and now the admin lists.

### Infrastructure

- **Brigade ↔ Ops-Center coupling audit.** Confirmed Brigade has zero
  runtime dependency on Ops-Center on bigboy. Dropped two vestigial env
  vars from `docker-compose.brigade.yml` (`OPS_CENTER_USAGE_ENDPOINT`,
  `BRIGADE_USE_OPS_CENTER_AUTH`) — neither was read by `app/`. The
  Ops-Center → Brigade direction (anthropic-proxy fan-out) is kept; it's
  the value-add integration the suite is designed around.

## [1.4.0] — 2026-04-30

### Added

- **`Avatar` primitive** (`components/ui/avatar.tsx`) — initials in a
  deterministic-coloured pill (djb2 hash → 8-bucket gradient palette).
  Same person = same gradient across the whole app. Used in user
  dropdown, task-card, kanban assignees.
- **Empty states** for the four list pages — Organizations, Contacts,
  Documents, Users. Each picks a tone matching the section, includes
  a primary CTA where relevant, and distinguishes "search returned
  nothing" from "no data yet".

### Changed

- **Sidebar active-item icon** now wraps in a tinted icon-well
  matching the section: Workspace = blue, CRM = emerald, Admin = rose.
  The active route reads instantly without darkening the whole row.
- **Recent Projects + My Tasks dashboard rows** get a richer hover
  treatment: 0.5px lift, border tint, soft shadow, 150ms transition.
  Matches the stat cards above them so the dashboard feels like one
  cohesive surface.

## [1.3.0] — 2026-04-30

### Infrastructure

- **Storage backend swap.** Dropped the orphan `project-ops-minio`
  service from compose. The bigboy deploy already routed every S3 call
  to the shared `unicorn-garage` (Garage v1.0.1) container; this makes
  that the official upstream config. Backend env vars are still named
  `MINIO_*` (Garage is S3-compatible) — rename to `STORAGE_*` is a
  separate cleanup pass.

### GUI polish

- New **`Skeleton` + `SkeletonText`** primitives (`components/ui/`).
  Theme-aware, slower pulse than Tailwind's default for ambient feel.
- New **`EmptyState`** primitive — tinted icon well, title, body,
  optional CTA. Uses the same icon-well tones as the dashboard stat
  cards so empty surfaces feel intentional rather than forgotten.
- **Loading states** rebuilt across Dashboard / My Tasks / Projects
  list / Project detail / Kanban — the placeholders now match the
  actual layout shape, no more pulsing rectangles.
- **Empty states polished** on the dashboard ("Inbox zero" with
  emerald icon when no pending tasks; "No projects yet" with primary
  CTA when the recent-projects list is empty).
- **Kanban drop zones** now read "Drop tasks here" idle and "Drop
  into {Column}" while a card is hovered, with a smooth border + tint
  shift between idle and over-target states.
- **Subtle page-mount animation** (`po-page-enter`) — 280ms fade-in-up
  on Dashboard / My Tasks / Projects / Kanban. Respects
  `prefers-reduced-motion`.

## [1.2.0] — 2026-04-30

### Added

- **Project-Ops MCP write tools (full surface):** `create_project`,
  `create_task`, `update_project_status`, `update_task_status`,
  `update_billing_fields`, `add_task_comment`,
  `list_project_documents`, `get_document_content`, `upload_document`.
  All RBAC-scoped, CLIENT users blocked from writes.
- **Brigade specialist agent** `project-ops-report-writer` for
  long-form drafts and PDF rendering. Parent agent delegates via
  `delegate_to_agent` for full reports while keeping
  `doc_generate`/`generate_pdf` for inline outputs.
- **Per-user knowledge memory.** Brigade's `knowledge_store` and
  `knowledge_query` now have `needs_caller_context=True` and override
  `agent_id` with `f"user:{caller_user_id}"` so FalkorDB partitions
  cross-conversation memory by user.
- **Coding-agent integration guide** at `docs/MCP_FOR_CODING_AGENTS.md`
  — wire Claude Code / OpenCode / Cursor / Continue / Zed to the
  Project-Ops MCP endpoint with a per-user JWT.

### Changed

- Agent system prompt rewritten with bucketed tool reference
  (Read / Write / Output / Memory / Delegation) and a knowledge_store
  schema example so the LLM gets it right first try.
- Agent runs on **local Gemma 4 26B-a4b on midboy1** (Tailscale
  `100.121.80.175:8087`) by default — `$0/call` for chat, full tool
  calling intact, ~3-5s per response.

## [1.1.0] — 2026-04-30

Initial MCP write tools (create_project, create_task,
update_project_status, update_task_status, list_project_documents).
See git log for the full picture.

## [1.0.0] — 2026-04-30

First production-ready release as Project Ops (the seed fork from NorthbridgeTax CPA
has been fully reskinned and reshaped — the rename, the AI-agent integration,
and the world-class landing page are all part of the same cut).

### Added

- **Inline AI assistant** in a sidebar on every dashboard page. Uses the
  `project-ops-assistant` agent in Unicorn Brigade with live read access to
  projects, tasks, and recent activity through a new MCP server at
  `/api/v1/mcp`. Six tools: `list_my_projects`, `get_project`,
  `list_my_tasks`, `search_projects`, `get_recent_activity`,
  `add_task_comment`. Per-user RBAC propagates via short-lived per-user JWT
  minted by Brigade for each tool call.
- **Marketing landing page** at `/` — hero with kanban showcase rendered
  inline using real UI primitives (no screenshot drift), AI-assistant
  spotlight with faux chat panel, eight-feature grid (Projects & tasks,
  Organizations & contacts, Billing & invoices, Client portal, Document
  workspace, Real-time collaboration, Activity & comments, SSO + audit
  trail), built-by trust band, closing CTA. Every "Sign in with Unicorn
  Commander" button carries The Colonel mascot.
- **Dashboard top bar** with contextual page title, user dropdown
  (avatar + name + role badge + Settings + Log out), and an "Ask"
  pill that opens the assistant.
- **Per-page browser titles** via `document.title` keyed off the route.
- **Grouped sidebar** — Workspace / CRM / Admin sections instead of a
  flat 9-item list.
- **Stat cards** clickable, lift-on-hover, route to relevant page.
- **`lib/badge-styles.ts`** — single source of truth for status, priority,
  payment, role, active-state, and icon-well class strings; opacity-tinted
  backgrounds + dark-mode-aware text.
- **`components/ui/dropdown-menu.tsx`** Radix wrapper.
- **`components/landing/kanban-showcase.tsx`** marketing-side kanban.
- **CHANGELOG.md** (this file).

### Changed

- **Theme** de-purpled. Primary now near-foreground (Linear-style); rainbow
  lives only on the mascot artwork and the tinted feature/status icons.
- **Light theme** background `#FFFFFF` → `#fafaf9` (warm off-white). Cards
  stay pure white so they lift gently. Borders softened.
- **Dark theme** background was purple-tinted `#0f0520`; now warm-neutral
  near-black `#08080a`. Cards `#15151a` → `#17171c` for visible elevation.
  Borders `#2a1545` → `#2e2e33`. Muted-foreground brightened to `#b4b4bd`
  for legibility.
- **Card component** ships a 1px inner-top highlight so cards lift in dark
  mode where black-on-black `box-shadow` is invisible.
- All dashboard pages, all create/edit modals, and supporting widgets
  (comments, documents, organizations hierarchy, project status update,
  top-organizations widget, etc.) migrated off hardcoded
  `bg-blue-100 text-blue-800` style classes to the shared helpers.
- Date columns use `date-fns format("MMM d, yyyy")` instead of locale-
  dependent `toLocaleDateString`. Task due dates show relative + absolute.
- Recent Projects on the dashboard spans full width; rows are clickable.
- Personalised dashboard welcome (`Welcome back, {firstName}`).
- Dashboard healthcheck switched to `/api/v1/health/live` (terminus
  memory checks were flapping under normal load).

### Fixed

- **`@SkipThrottle()` no-op against named throttlers in `@nestjs/throttler`
  v5** — health, MCP, and contacts controllers were 429-ing under normal
  scrape rate. Spelled out the throttler names (`{ short: true, long: true }`).
  This was also the root cause of the SSO redirect 404-ing intermittently.
- **Assistant panel** wasn't filling the viewport (`h-full` percentage
  on a fixed element). Switched to `h-screen` + `min-h-0` on the
  flex-1 child so the welcome content + suggestion chips render and
  the composer pins to the bottom.
- **Assistant panel** was scrolling to the bottom on first open, hiding
  the welcome heading + first two suggestions behind the header. Now
  scrolls to top on the empty state.
- **Task rows** rendered an orphan `P-00001 ·` because the API
  doesn't return `task.project.clientName` — switched to `project.title`.

### Infrastructure

- Brigade scheduler integration: the `projectops-verify` daily smoke
  test runs as a Brigade `ScheduledRun` (cron `0 13 * * *` UTC) instead
  of a host cron entry. Admin page at
  `https://brigade.magicunicorn.dev/scheduled-runs`.

[1.0.0]: https://git.unicorncommander.ai/MagicUnicorn/Project-Ops/src/tag/v1.0.0
