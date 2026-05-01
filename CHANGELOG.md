# Changelog

All notable changes to Project Ops live here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.20] — 2026-05-01

### Added

- **Dashboard now carries the colour treatment.** Stat cards (Total /
  Active / Completed / Due this week) get 4px tone-coloured left
  stripes + matching ~10% washes — mirrors the kanban + project-list
  pattern so the dashboard reads as a multicolour HUD instead of four
  neutral cards.
- **Project distribution charts.** Recharts donut + bar on the
  dashboard:
  - **Project status donut** — slice per status (NEW / IN_PROGRESS /
    UNDER_REVIEW / COMPLETED / ON_HOLD / ARCHIVED), colour-matched to
    the kanban's status colours, count legend below.
  - **Priority distribution bar** — LOW / MEDIUM / HIGH / URGENT
    counts, colour-matched, axes themed via CSS vars so dark + Vibrant
    render cleanly.
  - Tooltips themed via `var(--color-popover)` so they pick up the
    active theme (light / dark / vibrant) automatically.
  - Charts only render when at least one project exists; no empty SVG
    skeletons.
- Recharts pulled in (`recharts@3.8.1`).

### Changed

- **`cardWash` light-theme opacity bumped 5% → 10%.** The previous 5%
  was barely visible on white cards; 10% reads as a clear "this is
  Project X" signal without overpowering text contrast. Dark/Vibrant
  already used 10%, so all three themes are now consistent.

## [1.6.19] — 2026-05-01

### Fixed (v1.6.18 cardWash silently rendered nothing)

- **`cardWash` Tailwind classes weren't reaching the compiled CSS.**
  v1.6.18 used arbitrary-opacity bracket syntax (`bg-indigo-500/[0.04]`)
  for the Hive-style row tint. Tailwind 4's content scanner (under
  Turbopack) didn't pick up the bracket arbitraries from the
  `lib/project-colors.ts` object literals, so the CSS rules were
  never generated. Class names were in the rendered DOM but invisible
  in the browser.
  Switched all `cardWash` entries to standard-scale opacities
  (`/5` and `/10`). Verified: `bg-amber-500/5`, `bg-emerald-500/5`,
  etc. now appear in the compiled `static/chunks/*.css`. Same look
  (4–10% wash), reliably picked up.

## [1.6.18] — 2026-05-01

### Changed (Hive-style colour deepening)

After actually looking at the Hive reference shots Aaron pointed at,
the v1.6.16 per-project colour treatment was right in concept but
under-saturated in execution. Two missing pieces:

- **Subtle full-card colour wash** — Hive tints every row of a
  project's cards with a very faint background (~4–7% opacity) so the
  whole card reads as "this is a P-00014 card", not just a thin
  stripe. Added `cardWash` token to the `projectColorClasses` palette
  and applied to kanban cards, the projects list, and Recent Projects
  on the dashboard. Mounted *over* the dark/vibrant card token so
  text contrast stays clean.
- **Solid-fill status pills** — Hive's status column is a
  saturated coloured block with white text ("Completed" = solid
  emerald, "In Progress" = solid amber). New `statusSolidClass()`
  helper in `lib/badge-styles.ts` plus `STATUS_SOLID` map. Kanban
  cards now show the task status as a solid pill next to the project
  number chip.

The kanban now reads as a multicolour painted board: every card has a
left-stripe + faint full-card wash matching its project, plus a hard
status block. Combined with the Vibrant theme that's the closest match
to the Hive look the codebase can carry without a full table-view
rewrite.

## [1.6.17] — 2026-05-01

### Fixed (P1 — every POST/PATCH 500'd, all MCP write tools silently broken)

- **`InternalServerError: stream is not readable` on every write.**
  Reported by another agent who hit the bug while creating P-00017 via
  MCP. Trace bottoms out at
  `@sentry/core/.../integrations/express/patch-layer.js:197:36` and
  `body-parser/.../raw-body/index.js:185:17`.

  **Root cause:** Sentry SDK v10 default integrations include
  OTel-driven auto-instrumentation for HTTP/Express that patches every
  Express layer to attach span data — which includes consuming the
  incoming request body. That ran BEFORE NestJS's body-parser, so by
  the time NestJS read the stream it was already empty.

  **Blast radius:** every POST/PATCH 500'd. Every MCP write tool
  (`create_project`, `create_task`, `update_*`, `add_task_comment`,
  `update_billing_fields`, `upload_document`) was silently broken
  between v1.6.5 (when Sentry was added) and v1.6.16. The other agent
  worked around it by SSHing into bigboy and running Prisma directly
  in the container — confirmed P-00017 was created via that path,
  bypassing the audit log.

  **Fix:** filter the HTTP-layer-patching integrations out of Sentry's
  defaults (`Http`, `Express`, `Connect`, `Fastify`, `Koa`, `NestJs`,
  `NestJsFastify`) and set `tracesSampleRate: 0`. We keep pure error
  capture (which is the actual reason we wired Sentry) and drop
  express auto-tracing (which nobody queried). Errors continue to flow
  via the `SentryFilter` + process-level uncaught handlers.

  **If we want tracing back later:** install `@sentry/nestjs` properly
  and register it as a Nest module so Sentry's Express patch is
  sequenced AFTER body-parser instead of in front of it. Out of scope
  for this fix.

## [1.6.16] — 2026-05-01

### Added

- **Per-project colour tagging — Hive/Asana style.** Every project now
  carries a deterministic colour from a 10-colour palette (indigo,
  rose, emerald, amber, violet, cyan, pink, orange, lime, sky) hashed
  off the project's `id`. The colour shows up as:
  - **Kanban task cards** — 4px coloured left-edge stripe (overdue
    rose still wins so the urgency signal stays loud).
  - **Project number badge** — small pill with a tinted background +
    a saturated dot (`P-00001` reads like a chip, not just text).
  - **Project list rows** (`/dashboard/projects`) — coloured left-edge
    stripe + chip-style number.
  - **Recent Projects on the dashboard** — same treatment.
  - **No DB migration.** Colour is derived from `id`, so the same
    project always shows the same hue across users + sessions. If we
    later want operator-controlled colours, add a `color` column to
    the Project model and prefer it when set, falling back to this
    hash. Helper at `lib/project-colors.ts`.

This is the visual splash you asked for — colour comes from the data
(15 projects → up to 10 distinct hues, one per project) instead of
the chrome trying to be colourful on its own. Reads cleanly in Light,
Dark, and Vibrant themes.

## [1.6.15] — 2026-05-01

### Fixed (P1 — Vibrant theme crashed the dashboard)

- **`InvalidCharacterError: Failed to execute 'remove' on
  'DOMTokenList': The token provided ('vibrant dark') contains HTML
  space characters`** — v1.6.14 mapped the Vibrant theme to the
  multi-class string `"vibrant dark"` so Tailwind's `dark:` utilities
  would fire alongside the Vibrant tokens. next-themes calls
  `classList.remove(value)` to clear the previous theme, and DOMTokenList
  rejects space-separated tokens — every theme switch threw and broke
  React rendering on whichever page was mounted.
  Fixed by reverting to single-class theme values
  (`light` / `dark` / `vibrant`) and widening Tailwind 4's `dark:`
  variant to also match `.vibrant` via
  `@custom-variant dark (&:where(.dark, .dark *, .vibrant, .vibrant *))`
  in `globals.css`. Same outcome (every `dark:foo` utility fires under
  Vibrant), no DOM crash.

## [1.6.14] — 2026-05-01

### Added

- **`Vibrant` theme.** Third option in the theme cycle (Light → Dark
  → Vibrant → System). Deep aubergine background, violet-400 primary,
  warm amber accent, soft lavender muted-foreground. Magic Unicorn
  branding without going garish — chrome carries colour while still
  reading as a serious tool. Cycled via the `Sparkles` icon in the
  theme toggle. Layers `vibrant dark` on the html element so all
  existing `dark:` Tailwind utilities continue to fire.
- **Magic Unicorn organization seeded** in the database (`AGENCY` type,
  `industry: "AI infrastructure"`) and all 15 projects backfilled to
  reference it via `organizationId`. The kanban Organization filter
  now has something to filter against — was returning empty because
  the org table was empty (every project used the legacy free-text
  `clientName` only).

### Removed

- **Dead `components/kanban/*` directory** (6 files: kanban-board,
  kanban-board-v3, kanban-card, kanban-card-v2, kanban-column,
  kanban-column-v2). Stale NorthbridgeTax CPA implementations using
  `bg-blue-100 text-blue-800`-style pastels with no dark variants.
  Nothing imported them — the active kanban is `app/dashboard/kanban/page.tsx`
  with its own task card rendering. Removing eliminates the worst
  cluster of dark-mode-broken styling.

### Fixed (theme contrast pass)

- **Logo well backgrounds were stark white in dark mode.** Six
  `bg-white ring-1 ring-border` instances (landing nav, landing chat
  panel, landing footer, dashboard sidebar logo, two assistant-panel
  headers) now use `bg-white dark:bg-zinc-100` so the white card
  around the mascot doesn't burn through dark backgrounds.
- **Auth-page password eye-toggle buttons used `text-gray-500
  hover:text-gray-700`** which rendered as near-invisible-on-dark
  in dark mode. Switched to semantic `text-muted-foreground
  hover:text-foreground` tokens — works in all three themes.

## [1.6.13] — 2026-04-30

### Fixed (NorthbridgeTax CPA fork-leftover sweep)

- **`TaskType` enum was stale across the entire frontend.** The
  Project-Ops backend Prisma schema defines
  `TASK / MILESTONE / DELIVERABLE / REVIEW / MEETING / RESEARCH / OTHER`
  but five frontend files (kanban, task-card, task-details modal,
  create-task modal, edit-task modal) carried the old NorthbridgeTax CPA
  values (`DOCUMENT_REQUEST / QUESTION / IRS_CALL / FILING / …`).
  Result: the kanban Type filter dropdown showed wrong options and
  filtering by any of them returned **zero** tasks (no enum overlap
  with the backend). New tasks created via the modal saved with the
  wrong enum, which the backend silently coerced to `OTHER`. Brought
  the enum back in sync with the backend, and centralised
  label + icon pairing in **new `lib/task-types.tsx`** so all five
  consumers import from one source. Future schema changes only touch
  the helper.
- **Kanban "Client" filter pointed at a `/clients` endpoint that no
  longer exists.** The `Client` model was renamed to
  `Contact` + `Organization` during the Project-Ops fork, but the
  kanban kept calling `GET /clients` (404), swallowing the error in
  a try/catch, and rendering an empty "All Clients" dropdown.
  Replaced with an **Organization** filter backed by the live
  `/organizations` endpoint. Filter logic now matches projects by
  `project.organizationId` and falls back to `clientName`
  case-insensitive match for projects filed under a free-text client
  string.

### Why this kept biting

These were both stale wires from the original NorthbridgeTax CPA fork — the
backend and the schema got reshaped during the rebrand but a handful
of UI components retained the old domain model. Symptoms were quiet:
empty filter dropdowns, type filters that found nothing, and tasks
created via the UI silently coercing on save. The "kanban can't sort
by clients or projects" report was the first time these surfaced.

## [1.6.12] — 2026-04-30

### Fixed (P1)

- **`SentryFilter` was crashing on every 5xx, breaking the dashboard.**
  v1.6.5 added the filter as `new SentryFilter()` — but `BaseExceptionFilter`
  needs the `HttpAdapter` passed to its constructor to write the actual
  HTTP response. Without it, the moment any backend error path hit the
  filter it threw
  `TypeError: Cannot read properties of undefined (reading 'isHeadersSent')`.
  The filter then re-threw, the request retried, and the dashboard's
  parallel data fetches all failed in a tight loop — visible to the user
  as "the dashboard just keeps spinning".
  Caught by Glitchtip itself: 11+ instances logged in a 5-minute window
  while the user was trying to load the dashboard. Exactly the silent-
  failure bug class the v1.6.5 wiring was designed to surface — and
  it surfaced its own bug. Fixed by injecting `HttpAdapterHost` into
  the filter's constructor and forwarding to `super(...)`. Bumped
  package.json to 1.6.12 so `/version` reports the right number.

## [1.6.11] — 2026-04-30

### Documentation

- **Source-map upload to Glitchtip is wired but not yet functional.**
  Investigated end-to-end:
  - `withSentryConfig` correctly receives the auth token, sentryUrl,
    and project slug.
  - Releases ARE created in Glitchtip (`project-ops@1.6.10` and
    earlier visible via `Release.objects`).
  - Sentry CLI uses the chunked upload protocol (`chunkupload.start /
    .post.files / .end` visible in `glitchtip-web` logs) and hits the
    right endpoints with our token.
  - Glitchtip's File model receives `release-artifacts.zip` rows but
    they're **0 bytes** — the chunk POSTs land empty.
  - This is a known Glitchtip ↔ Sentry-CLI protocol gap (multiple
    users have reported the same symptom). Not something fixable from
    our SDK config — we'd need either a newer Glitchtip release that
    fixes the chunked-upload accept path, or to explicitly call
    `sentry-cli releases files upload-sourcemaps` (the older
    individual-file API) as a post-build step.
- **Build script reverted to `next build --turbopack`** since we get
  the same outcome (no maps in Glitchtip) regardless of bundler.
  Saves ~30s per build. Wiring (auth token, URL, sourcemaps config)
  stays in place — the moment Glitchtip's chunk-upload accepts the
  payload OR we add an explicit sentry-cli step, source maps light
  up. Logged as a known followup.

## [1.6.10] — 2026-04-30

### Added

- **Frontend source-map upload to Glitchtip.** `withSentryConfig`
  picks up `SENTRY_AUTH_TOKEN` + `SENTRY_URL` (defaults to
  `https://glitchtip.magicunicorn.dev`) and uploads `.map` files
  during `npm run build`. Stack frames in Glitchtip will resolve to
  real function names + line numbers from the original TypeScript
  instead of the minified `t.handleErr`-style frames.
  - Token consumed at build time only (Dockerfile ARG → builder ENV
    → drops out of the production image).
  - Without `SENTRY_AUTH_TOKEN` the plugin silently skips upload —
    Glitchtip still gets events, frames just stay minified.

### Changed

- **`backend/package.json` + `frontend/package.json` bumped to
  1.6.10** so `/version` reports the same number the CHANGELOG +
  release tag say. Was a longstanding 1.0.0 leftover from the
  NorthbridgeTax CPA fork — now matches reality.

## [1.6.9] — 2026-04-30

### Added

- **`GET /api/v1/version`** — unauthenticated endpoint returning build
  identity (`version`, `release`, `commit`, `builtAt`, `environment`,
  `node`, `uptimeSeconds`). One quick `curl` confirms which release
  actually shipped vs. what `git log` says shipped — closes the gap
  where a build cache miss or a stale image silently kept old code
  running. Throttler-skipped to match the rest of the health surface.

### Documentation

- **`docs/AI_ASSISTANT_DEMO.md`** updated — the "memory broken"
  callout has been replaced with a **Verified working** section
  showing the post-v1.6.4 transcript: the agent stored "stand-up
  summaries under 60 words" and recall returned **both** that fact
  and a fact stored in a March 2026 session. Real persistent
  cross-session memory. Added a tip about the literal-name vs.
  generic-`User`-entity mismatch so future readers don't trip on it.

## [1.6.8] — 2026-04-30

### Documentation

- **Glitchtip alert notifications followup logged.** Tried wiring
  Postmark SMTP into the Glitchtip container so issue notifications
  actually email Aaron + Shafen. The Postmark server token in the
  session-context credentials had been rotated since it was written
  down, so authentication failed (`535 5.7.8 Error: authentication
  failed`). Confirmed via a direct `smtplib` call from inside the
  container — not a URL-parsing issue, the token is genuinely dead.
  Reverted `GLITCHTIP_EMAIL_URL=consolemail://` to avoid Glitchtip
  burning retries against a broken auth on every issue. Action item
  for the next session: regenerate a Postmark server token (or pick
  any other SMTP provider — token-style auth means username = password
  = token), set it as `GLITCHTIP_EMAIL_URL=smtp+tls://TOKEN:TOKEN@smtp.postmarkapp.com:587`
  in `/home/muut/UC-Cloud-production/.env`, recreate the Glitchtip
  containers, then add an issue-occurrence Alert in the Glitchtip web
  UI (`https://glitchtip.magicunicorn.dev`) for both projects so
  events land as email at first occurrence.

## [1.6.7] — 2026-04-30

### Added

- **Frontend Sentry / Glitchtip integration** — `@sentry/nextjs` wired
  for browser + SSR + edge runtimes. Browser-side errors, unhandled
  rejections, error boundaries, and SSR Route Handler errors all flow
  to the same Glitchtip instance the backend reports to.
  - `sentry.client.config.ts` for the browser bundle, with sane noise
    filters (`ResizeObserver loop limit`, browser-extension errors).
  - `sentry.server.config.ts` + `instrumentation.ts` for SSR.
  - `sentry.edge.config.ts` to keep `withSentryConfig` happy.
  - `next.config.ts` wrapped with `withSentryConfig`. The Sentry plugin
    sets up the `/monitoring` tunnel route so the browser SDK posts
    through this origin instead of `glitchtip.magicunicorn.dev` —
    avoids ad blockers killing reports for users with strict privacy
    extensions.
  - DSN injected at **build time** (`NEXT_PUBLIC_SENTRY_DSN` arg in
    Dockerfile + compose) so it lands in the client bundle.
  - PII off — no cookies, no localStorage, no form values shipped.
- **Glitchtip is now publicly reachable** at
  `https://glitchtip.magicunicorn.dev` (Cloudflare-proxied → Traefik
  → `glitchtip-web` on bigboy). Required for the browser SDK to post
  events. Backend DSN switched from the Tailscale IP form to the
  public hostname for consistency.
- **`docker-compose.glitchtip.yml`** restored under `UC-Cloud-production/`
  (the original was missing). Captures the running env + adds Traefik
  labels for the new public hostname. Healthcheck via Python stdlib
  (the container has no `wget`/`curl`).

### Why this exists

Same reason as v1.6.5: silent failures kill us. Tonight's two big
fixes (Brigade env wiring, FalkorDB disabled) were both server-side,
but the broader bug class — a 500 on a dashboard page, a thrown
ErrorBoundary, an uncaught fetch rejection — now also surfaces.

### Known followup

- Source-map upload requires `SENTRY_AUTH_TOKEN` + a Glitchtip auth
  token. Stack traces in the Glitchtip UI will show minified names
  until that's wired. Not blocking — the event still has the right
  message + URL + user; we just lose function-level resolution. Plug
  in next time we touch the build pipeline.

## [1.6.6] — 2026-04-30

### Fixed

- **Backend container build was failing on bigboy** with `npm ci`
  rejecting the lock file ("Missing: @opentelemetry/* from lock file").
  Local dev was on Node 25 / npm 11; the Dockerfile targets
  `node:20-alpine3.19` (npm 10) — the two write transitive resolution
  differently. Regenerated the lock inside a matching Node 20
  container. The first attempt was silently re-mutated by
  `npm install` running locally between the regen and the commit;
  the second attempt skipped that step entirely. `npm ci` now passes
  cleanly.
- **Sentry DSN format.** Glitchtip stores project keys as UUIDs
  (`bd31b09a-571e-4674-...`) but the canonical Sentry-protocol DSN
  strips the hyphens (`bd31b09a571e4674...`). The first wired DSN
  was rejected by the SDK with `Invalid Sentry Dsn`; corrected via
  Glitchtip's `ProjectKey.get_dsn()`. End-to-end smoke test —
  `Sentry.captureException(...)` from inside `project-ops-backend`
  → flush returned `true` → issue visible in Glitchtip with the
  right title, project, and timestamp.

### Documentation

- Memory + this CHANGELOG record the audit on
  `auth.magicunicorn.dev` brand-matched login. The hostname is live
  on bigboy and serves the same `uchub` realm, but the `project-ops`
  Keycloak client is registered only on commander, and bigboy
  federates via OIDC broker (extra click for users). Brand-match is
  already done at the theme layer (`uc-1-pro` + realm displayName).
  Decision: keep `KEYCLOAK_URL=auth.unicorncommander.ai`; revisit
  if/when commander is no longer the user-store source of truth.

## [1.6.5] — 2026-04-30

### Added

- **Sentry / Glitchtip integration on the backend.** New `instrument.ts`
  initialises the Sentry SDK before NestJS bootstraps; new
  `SentryFilter` reports 5xx + uncaught exceptions through to the
  self-hosted Glitchtip on bigboy (`http://100.126.207.157:8765/`).
  4xx is intentionally not reported — those are the user's problem and
  would just be noise.
  - SDK is a no-op when `SENTRY_DSN` is unset (opt-in per environment).
  - Sets `user.id`/`email`/`username`/`role` on the report when
    Passport has populated `req.user`, so triage shows who hit the
    error.
  - Tags `http.method` + `http.url`.
  - `tracesSampleRate` defaults to 0.1 (light) but is configurable.
  - Release set to `project-ops-backend@<version>` so events bucket by
    deploy. Re-bumping the version naturally rolls the release tag.
- **`SENTRY_DSN_BACKEND` + friends** in `.env.example` and the live
  bigboy `.env`. Production wired up.

### Why this exists

Two of the bugs we shipped fixes for tonight (v1.6.3 Brigade env
wiring, v1.6.4 FalkorDB disabled) were silent failures — tools were
firing but the work wasn't landing, and the upstream log lines
declared "ok". Both would have surfaced in Glitchtip the moment
Aaron's first chat session hit the failing path. The integration is
specifically designed for that bug class — process-level
unhandled rejections + uncaught exceptions + 5xx HTTP responses
all flow through.

### Known followup

- **Frontend Sentry** (`@sentry/nextjs`) requires a publicly reachable
  Glitchtip URL. The current Glitchtip exposes only via Tailscale
  (`100.126.207.157:8765`) — fine for the backend container talking to
  a sibling on bigboy, not for browser-side errors. Add a Traefik
  label exposing Glitchtip at e.g. `glitchtip.magicunicorn.dev` (with
  the existing letsencrypt resolver) before wiring frontend.

## [1.6.4] — 2026-04-30

### Fixed

- **Cross-session memory was silently broken** (Brigade-side, surfaced
  while finishing the v1.6.3 demo). The Brigade compose carried
  `FALKORDB_ENABLED: "false"`, so the `KnowledgeGraphManager` initialised
  with `db = None` and every `knowledge_store` call returned
  `{success: false, error: "FalkorDB not connected"}`. Compounding it,
  the agent_routes log line only inspects `ToolResult.error` (which
  stays `None` on a success-shaped tool call), so the failed stores
  were logged as "ok" — no error banner anywhere. The agent then
  hallucinated "the knowledge graph is currently disconnected" when
  recall returned empty. Fixed by enabling FalkorDB in the Brigade
  compose and pointing it at `unicorn-falkordb:6379`. End-to-end
  verified: the agent stored a fresh preference, then a follow-up
  recall returned both the new fact and a fact stored in a March 2026
  session — real persistent per-user memory across sessions.

### Documentation

- `docs/AI_ASSISTANT_DEMO.md` updated — the "memory broken" callout
  rewritten as a "bug we caught + fixed during the demo" with the
  root cause (compose flag + misleading "ok" log line) so the next
  reader can see the diagnostic chain.
- `docs/AI_ASSISTANT.md` known-limits section adds a tip: ask about
  *preferences* / *facts about you*, not your full name, since
  facts are stored under a generic `User` entity scoped to your
  account.

### Known followup (not in this version)

- The graph index DDL in `graph_manager.py` uses Neo4j-flavoured
  `CREATE INDEX IF NOT EXISTS FOR (e:Entity) ON (e.name)` syntax
  which FalkorDB rejects with "Invalid input 'I'". Storage works fine
  without the indexes; this just clutters the logs on every container
  restart. Worth converting to `CREATE INDEX FOR (e:Entity) ON (e.name)`
  + try/except in a focused Brigade session.

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
