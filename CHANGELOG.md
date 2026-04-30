# Changelog

All notable changes to Project Ops live here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
