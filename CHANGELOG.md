# Changelog

All notable changes to Project Ops live here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`delete_task` MCP tool** — permanently delete a task by `taskId`. ADMIN only,
  matching REST `DELETE /tasks/:id` (`@Roles(UserRole.ADMIN)`). PAT scope
  `write:tasks`. Visibility is checked via `runScoped` + project filter before
  delete. **Intentional asymmetry vs `archive_project`:** project hard-delete is
  not exposed to agents (archive is the safe reversible alternative); task
  hard-delete is exposed because REST already allows it for ADMIN and agents
  need cleanup of mistaken creates.

### Added — dark, flag-gated

- **Ops-Center entitlement gate (first cut, OFF by default).** SSO sign-in can
  now be governed by the Ops-Center entitlements endpoint instead of the static
  `PROJECT_OPS_ACCESS_LIST`. When armed (`PROJECT_OPS_ENTITLEMENTS_ENABLED` +
  `UC_ENTITLEMENTS_URL`), the interactive SSO login forwards the user's uchub
  Bearer, allows iff the org carries `PROJECT_OPS_FEATURE_KEY` (default
  `project_ops_access`), seeds the JIT role from the org role (owner→ADMIN,
  else→STAFF), and **re-checks on every login** so a revoked entitlement locks a
  user out. Indeterminate results (endpoint outage/timeout) fail **closed**
  unless `PROJECT_OPS_ENTITLEMENTS_FAIL_OPEN` degrades to the allowlist. Inert
  until the UC dev's live URL lands — the flag-off path is byte-for-byte
  unchanged. New `backend/src/auth/entitlements.client.ts` (+ unit spec); wired
  through `KeycloakStrategy` → `AuthService.validateKeycloakUser`.

### Remaining for the tenancy GA

- **Phase E — uc-registry as the workspace source of record.** PO still mints
  the single dogfood bootstrap workspace locally; real workspace ids/metadata
  must read through uc-registry (PO mirrors, never mints, in production).
- **Production promote of the runtime-role flip.** Phases A–D run on dogfood
  with the runtime `DATABASE_URL` flipped to the NOBYPASSRLS `project_ops_app`
  role; promoting that to production is the remaining cutover.
- **Billable rollup live path.** The Accounting-Ops invoice rollup ships behind
  `BILLABLE_ROLLUP_LIVE` (default off) until the AO AR integration is signed off
  in production.

## [1.13.0] — 2026-06-27

An agent-surface release. An agent-readiness eval against the real 43-tool MCP
surface showed the model drives existing tools reliably but had **no tool for
several real capabilities** and would occasionally grab the nearest tool (e.g.
fabricate an "issue + send" on `create_billable_draft`) when none fit. This
release closes those gaps and hardens two existing tools the live loop tripped
on. Every new tool delegates to the same service the REST layer uses — one RBAC
+ workspace-RLS chokepoint — so an agent can never reach past its user's
permissions.

### Added

- **`create_custom_field`** — define a workspace custom field for TASK or PROJECT
  entities (delegates to `CustomFieldsService.create`; non-CLIENT, mirroring the
  membership-gated REST `POST`).
- **`issue_invoice`** — issue **and** send a billable invoice in one step via
  Accounting-Ops (`createBillableDraft({ autoSend: true })`), with an honest
  fallback to a draft preview when AO isn't connected/entitled. MANAGER/ADMIN.
- **`archive_project`** — the safe, reversible alternative to deletion
  (`status = ARCHIVED`). Hard delete is intentionally **not** exposed to agents.
- **Workspace member management** — `list_members`, `invite_member`,
  `update_member_role`, `remove_member` (delegates to `WorkspacesService`;
  OWNER/ADMIN gates + last-owner protection enforced by the service).

Each new tool is registered with a Zod input schema and PAT-scope-gated via
`MCP_TOOL_SCOPE_MAP` (reusing existing scopes — no manifest drift).

### Fixed

- **Request logs now surface in `docker logs`.** `@opentelemetry/instrumentation-winston`
  (on by default in the auto-instrumentations meta-package) hooked the logger and
  routed per-request records into the OTel logs pipeline; this SDK configures a
  trace exporter only, so those records were silently dropped — only boot-time
  logs reached stdout. The winston + bunyan log instrumentations are now disabled
  (we configure no log exporter, so this loses nothing); tracing and Sentry are
  untouched. The Console transport is pinned to `info`.
- **`list_my_projects` tolerates a free-text `status`.** Agents pass values like
  `"active"` or lowercase `"new"`; these reached Prisma raw and surfaced an opaque
  `Invalid value for argument status` 500. The filter is now case-normalized and,
  if still unknown, rejected early with the valid set so the caller self-corrects.
- **`get_project` accepts a project number in either field.** A human project
  number (`P-00110`) passed in the `id` field (or vice-versa) now resolves —
  the key matches either column, AND-nested so visibility scoping is preserved.

## [1.12.0] — 2026-06-20

A documentation, help, and presentation release — and the record of going to
production.

### Added

- **World-class README** — branded hero, a grouped feature map, the AI/MCP story,
  an architecture table, the prod + dogfood deployments, and a wired screenshot
  gallery (`docs/screenshots/`, ready for the product shots to drop in).
- In-app **Help** coverage for the **Agents** ledger (events + token usage/cost)
  and a refreshed **AI assistant** article reflecting the on-prem metered model.

### Changed

- Frontend and backend versions resynced to a single **1.12.0**.
- Docs now reflect the on-prem, metered LLM gateway (local Qwen 3.6 35B) — the
  assistant model reference in `docs/AI_ASSISTANT.md` corrected from Gemma.

### Operations

- **Production launch** — Project Ops is live at `projectops.unicorncommander.ai`
  (alongside the `projectops.magicunicorn.dev` dogfood).
- The in-app assistant now routes through a **metered, on-prem LLM gateway**
  (local Qwen 3.6 35B on a P40) — same model, now billable + hard-capped — and
  every turn lands in the Agents usage ledger.
- Per-instance **Garage** (S3-compatible) object storage stood up for production.
- New **`GET /api/v1/health/integrations`** operator diagnostic surfaces DB /
  Keycloak / Brigade / registry / storage health at a glance.

## [1.11.2] — 2026-06-19

### Added

- **`GET /api/v1/health/integrations`** — operator-facing diagnostics that report
  each external dependency (database, Keycloak, Brigade, uc-registry, object
  storage) as `ok` / `down` / `not_configured`. Always returns 200 with a
  per-integration `{status, configured, detail, latencyMs}`; probes are
  non-throwing config + reachability checks with fast timeouts (a configured
  dependency that is unreachable is `down`; an unset optional one is
  `not_configured`, not a failure). Reuses the existing Prisma/MinIO/registry
  config so the report mirrors what the app actually talks to.

## [1.11.1] — 2026-06-19

Completes the v1.11 cost dimension — and fixes a latent production outage the
agent ledger surfaced: the in-app assistant had **never** successfully answered.

### Fixed

- **In-app assistant was completely broken (operational / Brigade-side).** The
  `project-ops-assistant` Brigade agent ran a model loaded at a **2048-token**
  context, but the agent's prompt (its injected MCP tool schemas + system
  prompt) is **~5,300 tokens** — so every call failed with a context-overflow
  (`exceed_context_size_error`) and the assistant returned 500 on 100% of
  requests. Repointed the agent to **`Qwen3.6-35B-A3B`** (32k context,
  local/sovereign, no-think, a proven-reliable tool-caller) — it now answers in
  ~11s with real token usage and no `<think>` leakage. (The agent's graphiti
  memory subsystem, broken for the same reason, recovers too.) *Note: this is a
  live `brigade_db.agents` change; persist it in Brigade's agent seed so a
  Brigade redeploy doesn't revert to the broken model.*

### Added

- **Assistant-turn cost attribution.** `captureTurn` now records the resolved
  `model` and computes `costUsd` from a per-model price table
  (`assistant-pricing.ts`, overridable via the `ASSISTANT_TOKEN_PRICES` env).
  Brigade returns real token usage on success (it always did — the prior
  "usage is null" code comment was stale), so tokens were already captured; this
  makes **cost** real too. The current local/sovereign model is **free → a
  truthful $0**; an unknown/unpriced model yields `null` (the ledger shows "—")
  rather than a fabricated cost. Point the assistant at a billed model + add its
  price to surface real dollars.

## [1.11.0] — 2026-06-19

The **agent activity & usage ledger** — the agent analog of Timesheets /
Utilization. Where time-tracking answers "what did the *team* do and what's it
billable at," this answers "what did your *AI agents* do — and what did it
cost." Every MCP tool call and in-app assistant turn is now recorded as a
first-class, workspace-scoped event you can audit, chart, and mark billable.

### Added

- **`AgentEvent` ledger (backend).** A new `agent_events` table — workspace-scoped
  with the same Postgres RLS `workspace_isolation` chokepoint as every other
  tenant table — capturing `{ actorKind, actorKey, actorLabel, via, action,
  resource, tokensIn, tokensOut, costUsd, durationMs, billable, occurredAt }`
  plus optional project/task linkage. `actorKind` ∈ PAT / ASSISTANT / FEDERATED /
  USER / SYSTEM; `via` ∈ MCP / API / ASSISTANT / GUI / SYSTEM.
- **Automatic capture.** `McpService` records an event after each successful
  tool call (`via=MCP`, the tool name as the action, the touched entity as the
  resource, duration in ms — MCP tool calls are zero-cost *actions*, so
  tokens/cost are null). `AssistantService` records each assistant turn
  (`actorKind=ASSISTANT`). Both inject the recorder as an **optional** dependency
  so capture never blocks or breaks the request path.
- **`/agents` read API (ADMIN/MANAGER, workspace-scoped).** `GET /agents`
  (roster + totals), `GET /agents/activity` (filterable, paginated audit feed),
  `GET /agents/usage` (by-agent + time-series + totals), `GET /agents/:actorKey`
  (one agent's totals, per-project breakdown, usage-over-time, recent activity),
  and `PATCH /agents/activity/:id/billable` (flag a cost-bearing event billable).
- **"Agents" dashboard (frontend).** A first-class peer to Timesheets /
  Utilization under **Time & Billing**: KPI tiles (active agents, events, tokens,
  total + billable cost), an agent roster, usage & cost charts (events-over-time,
  cost-over-time, per-agent breakdown), and a filterable activity feed with an
  inline billable toggle. A per-agent detail page (`/dashboard/agents/[actorKey]`)
  drills into one agent. Hydration-safe date windows, the verified Recharts
  config, light/dark, `HelpHint`s explaining what counts as an agent event and
  why some rows carry no cost.

### Notes

- Many events carry **null** token/cost by design — MCP tool calls are recorded
  as actions, not LLM spend. Only assistant/LLM events carry tokens; cost
  attribution from the Brigade proxy is a follow-up (`TODO(cost)`).

## [1.10.0] — 2026-06-18

The "best-in-class → no-asterisk" pass: agent-native parity for the Wave 2
features, an in-app guidance layer (onboarding + tooltips), email notifications
with per-user preferences, a client-portal glow-up, and an accessibility +
mobile hardening sweep.

### Added

- **MCP agent parity for Wave 2.** 12 new MCP tools — `get_portfolio_report`,
  `get_profitability_report`, `get_throughput_report`, `get_team_capacity`,
  `get_my_capacity`, `list_automations`, `create_automation`,
  `set_automation_enabled`, `delete_automation`, `list_custom_fields`,
  `list_project_approvals`, `request_approval` — plus `customFields` /
  `recurrenceRule` / `estimatedHours` on the task & project create/update tools
  (43 tools total). All run the same workspace-RLS chokepoint + role gates as the
  REST API; 6 new scopes registered; the `.well-known/mcps.json` manifest advertises
  them to the federation.
- **In-app guidance.** A first-run onboarding experience (a welcome tour + a
  done-detecting "getting started" checklist) for staff and a warm welcome for
  clients, plus default-on, dismissible **tooltips** across the app that explain
  each non-obvious control and deep-link to the matching Help-center article. A
  "Show help tips" toggle + "reset tips/tours" live in Settings.
- **Email notifications + preferences.** Per-user email preferences (a master
  toggle + per-event switches) at Settings → Notifications, wired to a
  preference-gated email listener over the domain events (in-app notifications
  stay always-on). `GET`/`PATCH /notifications/preferences`;
  `User.notificationPreferences`.

### Changed

- **Client portal glow-up.** A hospitality pass on the customer-facing portal —
  a branded welcome hero, friendlier nav, elevated cards + empty states, a
  reassuring approvals page, a trustworthy invoices page with a confident Pay
  deep-link, and a client first-run welcome. Data wiring unchanged.
- **Accessibility.** Clickable cards are keyboard-operable (role=button +
  Enter/Space); the sidebar drawer manages focus + Escape + ARIA; nav uses
  `aria-current`; data tables get captions / `scope` / `aria-sort`; charts get
  `role="img"` + spoken data summaries; color-coded states carry text
  reinforcement; icon-only controls are labelled.
- **Mobile.** Dense reports/profitability tables degrade to sticky-first-column
  scroll under `md:`; org modals, the kanban filter bar, and settings grids
  reflow; touch targets ≥40px.

### Fixed

- **Dead animation utilities.** The kit's `animate-in`/`fade-in`/`zoom-in`/
  `slide-in` classes were silent no-ops (no `tailwindcss-animate`, Tailwind v4);
  defined them the v4 way (`@utility` + CSS-var keyframes) so dialogs, dropdowns,
  tooltips, and popovers animate, with a `prefers-reduced-motion` guard.
- Retired an inline, un-gated task-assigned email in `tasks.service` so the new
  preference-gated listener is the single source (no more double-email).

## [1.9.0] — 2026-06-18

Wave 2 — the feature set that closes the gap to a best-in-class PM tool:
recurring work, custom fields, an automation engine, outbound webhooks,
portfolio/profitability reporting, capacity planning, and a two-way client
portal. Built by a multi-agent swarm, integrated, and browser-verified on
dogfood.

### Added

- **Recurring tasks & projects.** An RRULE recurrence (`FREQ=DAILY|WEEKLY|MONTHLY`
  + `INTERVAL`) materialized by a daily cron into the next instance, with a
  "Repeats" picker on the create/edit forms.
- **Custom fields.** Per-workspace, per-entity (task/project) field definitions —
  text, number, date, select, multi-select, boolean — managed under
  Settings → Custom fields and rendered on the create/edit forms + task details.
  Values live on the entity's `metadata`.
- **Automations (rules engine).** When → If → Then rules over the domain-event
  stream: a trigger (task/project/comment lifecycle), optional conditions, and
  actions (assign, set status, comment, create task, notify). A Zapier-lite
  builder with a live plain-English preview, enable toggle, and run counts; an
  AsyncLocalStorage depth guard stops an automation's own writes from
  re-triggering it.
- **Outbound webhooks.** Per-workspace endpoints subscribe to task/project events
  and receive HMAC-SHA256-signed deliveries (`X-ProjectOps-Signature`) with retry
  and a delivery log; the signing secret is shown once on create.
- **Reporting.** Portfolio (budget vs logged, billed vs budget, % complete,
  over-budget), Profitability (billable/billed/cost/margin/realization, money
  manager-gated), and Throughput (completed-over-time) — charts + sortable tables.
- **Capacity planning.** Per-person committed hours (from task estimates) vs a
  pro-rated weekly capacity, with utilization bands, over-allocation flags, and an
  "unestimated tasks" warning. New `estimatedHours` on tasks +
  `weeklyCapacityHours` on users.
- **Two-way client portal.** Clients approve / reject / request changes on
  documents, deliverables, and projects, comment on their projects, and view
  invoices (with a pay deep-link — no in-app payment). Staff request approvals and
  see live client decisions from the project page.
- **Collaboration (folded in since 1.8.1):** subtasks & task dependencies,
  notifications + @mentions, and saved views with synced filters/sort.

### Fixed

- **Dashboard reliability.** A legacy `sort=field:dir` param (rejected by the
  strict validator) blanked the dashboard; Recharts 3 series rendered empty under
  React 19; a hydration mismatch (#418) from localStorage read during render; and
  the realtime-comments WebSocket namespace/token — all corrected.
- **Reporting totals contract.** Portfolio + profitability totals aligned to the
  client's expected shape (project/active counts, task totals, billable hours).

### Schema

- New tenanted tables (RLS `workspace_isolation` + grants):
  `custom_field_definitions`, `automation_rules`, `webhook_endpoints`,
  `webhook_deliveries`, `approvals`; recurrence columns on `tasks`/`projects`;
  `tasks.estimatedHours` + `users.weeklyCapacityHours`.

## [1.8.1] — 2026-06-10

Tenancy hardening point release: claimless callers resolve correctly, and two
write-side RLS escapees the live fence caught are closed.

### Fixed

- **Tenancy: claimless MCP/PAT callers now resolve to their default membership.**
  The MCP/PAT workspace chokepoint resolved a caller carrying no explicit
  `workspace_id` token claim to the global `DEFAULT_WORKSPACE_ID`, then authorized
  membership against it — so any user whose only active membership is some other
  workspace (e.g. a partner in their own org) was 403'd on every tool with "Not a
  member of the requested workspace". `WorkspaceContextService.resolveAuthorized`
  and the MCP `runScoped` + `workspaceFor` chokepoints now pass the addressing
  precedence straight down (explicit request → the token's own claim → the user's
  default membership), never substituting the env default as the requested
  workspace. The time-tracking MCP tools were folded onto the same
  membership-aware resolver. Tenancy-off behavior is unchanged; on dogfood the
  only user whose resolution changes is the one whose default membership wasn't
  the env default.
  (`backend/src/common/workspace/workspace-context.service.ts`,
  `backend/src/mcp/mcp.tools.ts`; regression specs in
  `workspace-context.service.spec.ts`.)
- **Two RLS `WITH CHECK` escapees caught live by the fence.** With the runtime
  flipped to the non-bypass role, two write paths surfaced rows whose post-image
  didn't satisfy the `workspace_isolation` policy; both are corrected so the
  write carries the request workspace and passes `WITH CHECK`.

## [1.8.0] — 2026-06-09

The tenancy fence goes live and federation gets a trusted intake. RLS is now
**enforced** on dogfood: the runtime connects as the NOBYPASSRLS
`project_ops_app` role, so a workspace's rows are provably invisible and
unwritable from any other workspace's GUC. Ships the time-tracking spine
alongside.

### Added

- **Federation-trust triage ingest for trusted sibling apps.** The triage
  `ingest` path accepts candidate action items from trusted federated callers
  (Brigade actor / sibling suite apps), gated by the configured
  `PROJECT_OPS_FEDERATION_ACTORS` allow-list, with a generous
  interactive-transaction window so a large batch ingest doesn't time out
  mid-transaction.
- **Suite tenancy foundation → live fence (Phases A–D).** `Workspace` +
  `Membership` model, the `app.current_workspace` GUC chokepoint
  (`current_workspace_id()`), and ENABLE+FORCE Row Level Security with a
  `workspace_isolation` policy (`USING` + `WITH CHECK`) on every
  workspace-scoped table. The runtime `DATABASE_URL` flips to the NOBYPASSRLS
  `project_ops_app` role so the policy is actually exercised (the owner role
  keeps `BYPASSRLS` for migrations/maintenance). Module wire-through routes
  every query through `PrismaService.withWorkspace` (B1–B9, incl. the triage
  per-workspace `ProjectIndex` cache and tx reconciliation); PAT workspace
  scoping is enforced at the app layer (C1); auth login/profile/SSO return
  `workspaces[]` for the switcher (C2); a Phase-2 frontend workspace switcher
  (C3) and dogfood workspace seed (C4) land; client-portal signup/login is made
  RLS-correct via a provisional invite membership. The §9 RLS
  workspace-isolation integration suite + fixtures + runner prove the fence
  holds (fail-closed read AND write) against `project_ops_app`, and assert the
  connected role is genuinely NOBYPASSRLS so a misconfigured URL can't produce a
  false green.
- **Magic Unicorn re-keyed to the suite-canonical workspace uuid.** The dogfood
  Magic Unicorn workspace is re-keyed from its local bootstrap id to the
  suite-canonical workspace uuid (shared with the other ops modules), via an
  idempotent migration; the §9 fixtures and seeds carry the new id.
- **Time Tracking + Billable Rollup — the professional-services spine.**
  Logged work now becomes billable amounts that flow to Accounting-Ops
  for invoicing. Backend-complete and tested; ships behind
  `TIME_TRACKING_ENABLED` (default on) and `BILLABLE_ROLLUP_LIVE` (default off).
  - **Data model** (`backend/prisma/schema.prisma`): `TimeEntry`,
    `BillingRate` (multi-scope rates), `TimesheetPeriod`, plus policy fields
    on `Project` (`billByDefault`, `defaultBillRate`, `budgetHours`,
    `budgetAmount`, rounding) and `Task` (`billable`, `billRate`). Every new
    row carries a NOT NULL `workspaceId`. The "at most one running timer per
    user" invariant is a partial unique index applied in
    `PrismaService.onModuleInit` (Prisma can't express it) **and** enforced in
    the service.
  - **Engine** (`backend/src/time-tracking/`): deterministic rate resolution
    (Task override → TASK → TASK_TYPE → PROJECT → project default → CONTACT →
    USER_PROJECT → USER → ROLE → ORG; cost rate resolved independently and
    never shown to CLIENT), configurable rounding (raw + rounded both stored),
    timer lifecycle, manual entry with overlap guard, lock/billed immutability,
    and a weekly submit → approve/reject approval flow that locks on approval.
  - **Billable rollup → Accounting-Ops**: a source-agnostic assembler groups
    approved, billable, unbilled entries into invoice line items with a
    deterministic, retry-safe `external_ref` (hash of the source-id set — never
    double-bills). The live call hits AO's REST AR API forwarding the caller's
    bearer; on a not-entitled / unreachable / disabled result it degrades to a
    draft + PDF preview ("connect Accounting-Ops to invoice"). AO has no
    webhooks, so a `@Cron` poller mirrors invoice status onto the project
    billing fields.
  - **Surfaces**: REST controllers (time entries, timesheets, billing rates,
    reports, billing), 10 MCP tools (`start_timer`, `stop_timer`, `log_time`,
    `update_time_entry`, `list_time_entries`, `submit_timesheet`,
    `approve_time`, `get_utilization`, `create_billable_draft`,
    `sync_invoice_status`) with new `read:time` / `write:time` scopes, websocket
    events (incl. a new per-user room for the timer widget), and `AuditLog`
    on every mutation. Reports cover utilization, realization, WIP, and CSV
    export.

### Build

- Regenerated `package-lock.json` with the build-image npm (`node:20-alpine3.19`)
  so `docker npm ci` is reproducible (incl. the `@opentelemetry` dep resync).

## [1.7.0] — 2026-06-08

First tagged release since v1.6.58; rolls up everything merged to `main` since.

### Added

**Project-Ops Triage Agent (PO-owned).** A source-agnostic intake that turns
candidate action items (from Meeting-Ops finalize, or any caller) into routed,
deduped task *proposals* for human review — nothing becomes a task without an
approval. Backend module at `backend/src/triage/` (per-item embeddings + rerank
on Infinity, reasoning on a local Qwen, all over the LAN); endpoints under
`/api/v1/triage` (`ingest`, `inbox`, `proposals`, `proposals/:id/approve`,
`proposals/:id/reject`, `create-project`), each guarded by `JwtAuthGuard` +
`Roles(ADMIN|MANAGER|STAFF)`. New `submit_candidate_action_items` MCP tool
(scope `write:tasks`) in the manifest so Brigade and other suite apps can submit
candidates. New review UI at `/dashboard/triage` (Needs-a-project / Routed /
Possible-duplicates / Set-aside, with approve/reject, project override, and
create-project-from-unassigned). New `triage_proposals` table.

**Brigade federation + Personal Access Tokens.** Federation broker + manifest
(RS256 signing); `JwtStrategy` resolves Brigade-issued JWTs via Brigade JWKS and
SSO; Personal Access Tokens for direct MCP-client integration (PAT service +
Settings "API tokens" UI + scope-gated MCP); MCP organization tools
(list/get/update/create + project org reassignment); Garage object-storage
cutover via env.

### Fixed

- Auth: enforce audience-binding on Brigade-issued JWTs; fall back to
  `sub`-as-email for Brigade tokens missing an email claim; dual-token strategy
  accepts Keycloak realm tokens.
- MCP `create_project` project-number collision when `P-XXXXX` and
  `PROJ-YYYY-XXXXXX` formats coexisted.
- Coerce date-only strings to `DateTime` before Prisma writes.

## [1.6.59] — 2026-05-13

### Fixed

**MCP `create_project` numbering collision.** The MCP-side
project-number generator picked the wrong "last" row when both
formats (`P-XXXXX` from MCP, `PROJ-YYYY-XXXXXX` from the seed/web
UI) coexisted in the database. `findFirst({ orderBy: { projectNumber:
'desc' } })` returns rows in lexicographic order, so a row like
`PROJ-2026-000072` sorts after every `P-XXXXX` and was returned as
`last`. The regex `/P-(\d+)/` then failed to match the `PROJ-` prefix
(because `R` follows `P`, not `-`), the next number defaulted to `1`,
and Prisma threw `Unique constraint failed: projectNumber` on the
attempted `P-00001` insert.

Two-line fix in `backend/src/mcp/mcp.tools.ts`:

1. `findFirst` now filters to rows whose `projectNumber` starts with
   `P-`, so MCP-generated rows are the only candidates.
2. Anchored the regex to `^P-(\d+)$` for defensive parsing.

Hot-patched on the bigboy `project-ops-backend` container 2026-05-12
to unblock the PeerTube project (P-00033); this commit lands the same
change in source so it survives a rebuild.

## [1.6.58] — 2026-05-03

### Fixed (post-overnight nits)

Three small cleanups after a code-review pass over the v1.6.51-57
batch:

1. **Print stylesheet card selector is now durable.** The card-flatten
   rule used `[class*="rounded-lg"][class*="border"]` which would break
   silently if the Tailwind class names ever changed. Added a `po-card`
   semantic class to the `<Card>` component itself; print rule now
   targets `.po-card`.
2. **Removed the no-op `a[href]:after { content: "" }`** rule from the
   print block — was a leftover scaffold with an opt-out comment but no
   effect. Cleaner stylesheet.
3. **`<ExportCsvButton>` outside-press now uses `pointerdown`** instead
   of `mousedown`. Same desktop behaviour, but mobile/touch users can
   actually dismiss the popover by tapping outside it now.

## [1.6.57] — 2026-05-03

### Changed (README refresh covering v1.6.39–56)

The README's "What's inside" section had drifted — most of what
shipped over the v1.6.39–56 sprint was visible only via
`CHANGELOG.md`. Now the top of the README surfaces the active set
of UX primitives a user actually meets in the dashboard:

- Star projects / contacts / organisations + pin tasks (cross-page
  Cmd+K Starred section)
- Cmd+K **Recent** section (last 6 detail-page visits)
- Bulk actions on every list page (six pages now, was three at
  README-write time)
- Saved views — clarified that built-in starting points ship per
  page
- CSV export with the date-range + status scope popover (v1.6.52)
  on every list page
- Assistant in popped corner-widget mode (v1.6.45)
- Print-friendly project detail page (v1.6.56)

Docs-only release. No code or schema changes; no container rebuild
required.

## [1.6.56] — 2026-05-03

### Added (Print stylesheet for project detail page)

The project detail page is the most-printable surface in the
dashboard — clients and ops folks ask for "the project as a paper
status report" routinely. It now prints cleanly:

- **Print button** in the header (next to Edit) calls
  `window.print()`. Uses the lucide `Printer` icon.
- **`@media print` stylesheet** in `globals.css` (applies globally,
  not just to project detail):
  - Hides the sidebar (`aside`), the sticky topbar, and any element
    tagged `.no-print` (interactive headers, action buttons,
    assistant panel, etc).
  - Resets the `lg:pl-64` content offset so the printable area
    fills the page.
  - Forces a white background + dark ink, but keeps badge/status
    fills via `print-color-adjust: exact` so the colour vocabulary
    survives.
  - Flattens the responsive `grid` to a single column so the
    right-rail (client info, billing) drops below the main column.
  - Page-break-inside on cards so a single Card doesn't get
    cleaved across pages where avoidable.
  - 18pt h1 / 14pt h2 / 12pt h3 / 11pt body for paper.
  - 0.6in margins.
- **`.print-only` print header** at the top of the project detail
  page, replacing the interactive header at print time. Shows
  project number · status · title · printed-at timestamp +
  source URL — so the printout is self-describing.

`.no-print` and `.print-only` are reusable utility classes; we'll
expand to other surfaces (invoices, tasks lists) as need arises.

## [1.6.55] — 2026-05-03

### Changed (Kanban empty-state polish)

`/dashboard/kanban` used to render four empty drag-targets when
the board had no tasks — visually noisy and didn't tell the user
how to recover. Replaced with the dashboard's `<EmptyState>`
primitive in two flavours:

- **No tasks at all** — violet `LayoutGrid` icon, "Your board is
  empty", primary **New task** CTA that opens the create modal.
  The four columns are hidden entirely; once you create a task
  they re-appear.
- **No tasks match the current filters** — amber `Search` icon,
  "No tasks match the current filters", outline **Clear filters**
  CTA that calls the existing `handleClearFilters`.

The per-column "Drop tasks here" boxes still render exactly as
before once at least one task is in view, since they're useful
during drag.

## [1.6.54] — 2026-05-03

### Added (Pinned tasks on My Tasks)

Each task card now exposes a small pin toggle (left of the type
icon, mirrors the star pattern shipped on Projects/Contacts/Orgs
in v1.6.47/51). Click the pin and the task floats to a dedicated
**Pinned** card at the top of My Tasks above the regular list,
with an amber accent stripe.

- `lib/starred.ts` gained a `"tasks"` scope; same module-level
  helpers + scoped localStorage key
  (`projectops:starred:tasks`).
- `<TaskCard>` and `<TaskList>` got optional `pinned` /
  `onTogglePin` props so the pin UI is opt-in. Anywhere
  `<TaskList>` is rendered without the prop continues to render
  exactly as before (project detail, etc).
- The Cmd+K palette now includes pinned tasks in its merged
  **Starred** section so a pinned task is also one keystroke
  away from anywhere in the dashboard.

The Pinned section auto-respects the active filter set — pin a
task, then filter to "Completed" and the pinned task disappears
along with the rest until the filter clears. Same intent the
Recent section applies on the Cmd+K palette.

## [1.6.53] — 2026-05-03

### Added (Bulk actions on Organizations)

The Organizations list now supports the same multi-select +
floating action bar that v1.6.40/41 shipped on Projects, Tasks,
Contacts, Documents, and Users. Per-row checkbox + a leading
"select all visible" header checkbox; selected rows tint primary
without losing the per-org colour stripe.

Three actions in the bar:

- **Activate** — bulk-set `isActive: true`
- **Deactivate** — bulk-set `isActive: false`
- **Delete** — confirm dialog ("This will deactivate the
  organization (soft delete)"), then `DELETE /organizations/:id`
  per selected row

Same `useBulkRunner` hook as the other pages — N parallel
`Promise.allSettled` requests, aggregate toast on completion.

## [1.6.52] — 2026-05-02

### Added (CSV export popover — date-range + status scope)

The plain Export CSV button on every list page is now a popover:
clicking it opens a small panel with two scope controls that
narrow the export *without* touching the list's active filters.

- **Date range** chips: All time / Last 7 / 30 / 90 days / Custom
  (date pickers). Each list page picks the most useful date column
  to scope by — Created for Projects / Contacts / Organizations /
  Documents / Users; **Due** for My Tasks (matches what you'd want
  when exporting "tasks due this week").
- **Status / type / role / activity** chips: pick one or many to
  filter to. Per page:
  - Projects → Status (NEW…CANCELLED)
  - My Tasks → Status (PENDING…CANCELLED)
  - Contacts → Active state
  - Organizations → Type (Agency / Business / Individual)
  - Documents → File type (Image / PDF / Spreadsheet / Other)
  - Users → Role (Admin / Manager / Staff / Client)
- A live "**N of M records**" counter updates as scope changes; the
  Export button shows the same N. A small "scoped" badge appears
  on the trigger when any non-default scope is set.
- The popover defaults to "no extra scope" so the historical
  one-click behaviour (export everything currently visible) is
  preserved — just open + click Export.

`components/ui/export-csv-button.tsx` is the reusable primitive
(generic over the data type, takes `dateField` / `statusField` /
`buildHeader` / `buildRow`). All six list pages migrated; the
inline csv builder code on each page is gone.

## [1.6.51] — 2026-05-02

### Added (Star contacts + organizations — consistency with projects)

The star button v1.6.47 shipped on Projects now lives on Contacts and
Organizations too. Click the star next to any row to flag — local-only,
per-browser, per-entity-type. The Cmd+K palette's **Starred** section
merges all three scopes so a single jump-back surface lists every
explicitly-pinned project, person, and org.

- `lib/starred.ts` is now scope-aware: `useStarred("projects" |
  "contacts" | "organizations")`. Each scope persists to a separate
  localStorage key (`projectops:starred:<scope>`). Same module-level
  helpers + custom-event sync as before.
- Star button on Contacts list rows (left of avatar) and Organizations
  list rows (left of the building icon well). Identical visual
  treatment to Projects: amber fill when on, muted when off.
- `<CommandPalette>` subscribes to all three sets and merges into one
  Starred section; capped at 8 across the union so the palette stays
  scannable.

Cross-device sync still requires a backend table — same future-work
note as v1.6.47.

## [1.6.50] — 2026-05-02

### Added (CSV export on Documents + Organizations)

The last two list pages got Export CSV buttons too. Every list
page in the dashboard now offers one-click downloadable snapshots
of whatever the current filter + sort is showing.

- **Documents** — File Name / Type / Size / Project ID / Uploaded.
- **Organizations** — Name / Type / Industry / Tax ID / Active /
  Created.

## [1.6.49] — 2026-05-02

### Added (CSV export on My Tasks + Users)

- **My Tasks** — Title / Project / Status / Priority / Type / Due
  Date / Created. Honours the active filter set + sort.
- **Users** — First / Last / Email / Username / Role / Active /
  Last Login / Created. Admin-only page anyway.

Same `lib/csv-export.ts` helper as v1.6.48 — every list page that
gets viewed regularly now has a one-click downloadable snapshot.

## [1.6.48] — 2026-05-02

### Added (CSV export on Projects + Contacts)

Both list pages got an "Export CSV" button next to the New… action:

- **Projects** — exports the currently filtered + sorted set with
  Project Number / Title / Client / Status / Priority / Created /
  Due Date / Assigned To / Billing Amount / Amount Paid / Payment
  Status. Whatever's in view is what gets exported, so a saved view
  ("Active only") doubles as a download preset.
- **Contacts** — First Name / Last Name / Email / Phone / Company /
  Organization / Active / Created.

Filenames are date-stamped (`projects-2026-05-02.csv`). UTF-8 BOM
prepended so Excel reads accents properly. RFC-4180 quoting on cells
with commas / quotes / newlines.

`lib/csv-export.ts` is the helper — `downloadCsv` + `csvFilename`.
Same util can be wired into Tasks / Documents / Users in a follow-up.

## [1.6.47] — 2026-05-02

### Added (Star/favorite projects)

Each project on the Projects list grew a star button next to its
project number. Click to flag that project as starred — local-only,
per-browser. Starred projects surface in the Cmd+K palette under a
new **Starred** section above Recent.

- `lib/starred.ts` — module-level set + React hook
  (`useStarred()`) backed by localStorage
  (`projectops:starred:projects`).
- Star icon stays in sync across components on the same page via a
  custom `projectops:starred-changed` event.
- Cross-tab sync via the standard `storage` event.

Cross-device sync would require a backend table — filed for the
next session if anyone asks.

## [1.6.46] — 2026-05-02

### Added (Recently visited surface in Cmd+K)

`<CommandPalette>`'s empty-query state now leads with a **Recent**
section showing the user's last 6 detail-page visits across
projects / contacts / organizations (tasks not yet — the task list
doesn't currently route to a detail page). One keystroke (⌘K, ↵)
jumps back to where you were yesterday.

- `lib/recently-visited.ts` — module-level helpers backed by
  localStorage (key `projectops:recently-visited`). Capped at 8
  entries per type so an active org user doesn't bury contact
  visits.
- Each detail page (`projects/[id]`, `organizations/[id]`,
  `contacts/[id]`) calls `recordVisit({ id, type, title, subtitle,
  href })` once the entity loads. Cheap, bounded, no backend
  round-trip.
- The palette's `getRecent()` call is synchronous (localStorage
  read) so opening Cmd+K stays instant.

## [1.6.45] — 2026-05-02

### Added (popped assistant — corner-widget mode)

The `<AssistantPanel>` was a full-height side drawer with a backdrop
that blocked the rest of the dashboard. Now it has two modes:

- **Side drawer** (default) — what was there before. Best for
  long-form chat sessions.
- **Popped** — fixed bottom-right corner widget, ~380×560, no
  backdrop. The dashboard stays interactive while the assistant is
  open, so you can ask "what's on my plate this week?" and click
  through to the answer in the same gesture.

Toggle via the header button (Minimize2 → pop / PanelRightOpen →
expand back). Choice is persisted in localStorage so the next
"Ask" opens in the same mode.

## [1.6.44] — 2026-05-02

### Fixed (team-members fetch storm on Projects list)

The `<AssignProject>` row component fetched `/users?limit=…` from
its own `useEffect`. With 27+ projects in view that meant 27+
simultaneous round-trips on every render of `/dashboard/projects`,
which sporadically hit the NestJS throttler and surfaced as
"Failed to load team members" toasts on a normal page render.

Fixed by lifting the fetch to a shared `lib/team-members.ts` with:
- A module-level cache + single in-flight promise (every consumer
  awaits the same request the first one kicked off; subsequent
  mounts are synchronous against the cache).
- A `useTeamMembers()` React hook that returns
  `{ members, loading, error }`.
- An `invalidateTeamMembers()` escape hatch for after a known
  user-table mutation.

Net: 27→1 `/users` round-trips on the projects list, and the
"Failed to load team members" toast goes away.

## [1.6.43] — 2026-05-02

### Added (saved views — filter presets per list page)

`<ListToolbar>` gained an optional `views` prop that adds a Views
dropdown next to Sort. Two flavours of view:

- **Built-in defaults** (always present, can't be deleted) — sensible
  starting points per page, e.g. Projects: "Active only", "Urgent
  priority", "Recently updated"; Tasks: "Pending", "In progress",
  "Urgent"; Contacts: "Active only", "Recently updated"; Documents:
  "PDFs only", "Images only"; Users: "Admins", "Active only".
- **User-saved**: click "Save current as view…" in the dropdown,
  give it a name; a snapshot of every filter + sort + search value
  is persisted to localStorage under `projectops:saved-views:<scope>`.
  Click the saved view to restore the state. Trash icon next to a
  user view deletes it.

Lives entirely client-side (localStorage) so no backend changes; new
filters added later don't break old views (unknown keys are ignored
at apply time).

Wired into all six list pages: Projects, My Tasks, Contacts,
Organizations, Documents, Users.

`lib/saved-views.ts` is the data layer (load / save / built-in
registry); the toolbar's `<ViewsDropdown>` is the UI.

## [1.6.42] — 2026-05-02

### Added (per-org / per-contact snapshot cards)

`<ProjectsRollupCard>` (new in `components/project/`) summarises a list
of projects: Active count, Completed count, Total billed, Outstanding,
plus a project-status donut and priority bar. Mirrors the per-project
`<ProjectSnapshot>` (which summarises tasks) so the dashboard, project
detail, and CRM detail pages share one chromatic vocabulary.

- **Organization detail** (`/dashboard/organizations/[id]`) — the
  Projects tab now opens with the rollup card above the project list.
  Picks up the include-child-orgs toggle automatically.
- **Contact detail** (`/dashboard/contacts/[id]`) — the right-column
  Projects card is preceded by the rollup, summarising every project
  this contact is associated with.

Empty state: friendly card instead of empty SVGs when there are no
projects to summarise.

## [1.6.41] — 2026-05-02

### Added (bulk actions on Tasks / Contacts / Documents / Users)

The remaining four list pages adopt the v1.6.40 `<BulkActionBar>`
pattern. Per-page actions:

- **My Tasks** — Set status (5 statuses), Delete
- **Contacts** — Activate, Deactivate, Delete
- **Documents** — Delete
- **Users** — Activate, Deactivate (no delete; deactivate is the
  soft-delete on this entity)

`<TaskCard>` gained optional `selected` + `onToggleSelect` props so it
can render the checkbox + ring without forcing the project-detail page
to also adopt selection. `<TaskList>` passes them through.

Documents / Contacts / Users tables added a leading checkbox column
with header-level "select all visible" and per-row toggle. Selected
rows tint primary so the selection is visible at a glance even with
the per-project colour stripe in play.

## [1.6.40] — 2026-05-02

### Added (bulk actions on Projects)

The Projects list now supports multi-select + bulk actions. Click the
checkbox on any row (or "Select all in view") and a floating
`<BulkActionBar>` slides up at the bottom of the viewport with:

- **Set status** — bulk-move every selected project to a new status
  (NEW / IN_PROGRESS / UNDER_REVIEW / COMPLETED / ON_HOLD / CANCELLED)
- **Delete** — confirm dialog, then soft-delete every selected project

Selected rows get a primary ring + offset so the selection is visible
without losing the per-project colour stripe.

Internals:
- `<BulkActionBar>` (`components/ui/bulk-action-bar.tsx`) — reusable
  floating shell + `useBulkRunner` hook.
- `useBulkRunner` runs N parallel single-entity requests via
  `Promise.allSettled`, then toasts the aggregate result (success /
  partial / failure). When backend bulk endpoints land
  (`POST /projects/bulk-update`, etc) the hook stays the same — we
  just swap the `op` to the bulk URL.

Tasks / Contacts / Documents / Users list pages get the same
treatment in v1.6.41.

## [1.6.39] — 2026-05-02

### Added (inline task status edit)

Task cards on My Tasks (and anywhere else `<TaskList>` is rendered)
now expose a `<TaskStatusUpdate>` dropdown in place of the static
status pill. Click the pill, pick a new status, the task moves
without opening the edit modal — same UX the projects list shipped
with the StatusUpdate component on the project rows. Stops
propagation so the row's open-modal click doesn't fire while you're
choosing a status.

### Fixed (README phantom env var)

Removed reference to `INITIAL_ADMIN_EMAILS` — that variable doesn't
exist in code; the actual fallback when `PROJECT_OPS_ACCESS_LIST` is
unset is a hardcoded two-entry allowlist (Aaron + Shafen as ADMIN)
defined in `backend/src/auth/access-list.ts`. README now describes
the real behaviour.

## [1.6.38] — 2026-05-02

### Changed (list pages stop silently truncating)

The Projects / My Tasks / Documents / Users list pages were fetching
`?limit=100` and rendering whatever came back, with no indication that
more rows might exist beyond the cutoff. Bumped the limit to 500 and
surfaced the API's `meta.total` so the user can see when they're
hitting the wall:

- New amber line: "Showing first 500 of 1,217. Refine filters to
  narrow further." appears beneath the result count when the total
  exceeds what's loaded.
- 500 is the new ceiling for now — proper paging (cursor or page
  buttons) is a follow-up. For 99% of teams, 500 is plenty headroom
  without performance pain.

## [1.6.37] — 2026-05-02

### Added (Cmd+K command palette)

Global keyboard-first jump surface for the dashboard.

- **`<CommandPalette>`** (`components/command-palette.tsx`) — modal
  dialog with a search input + filterable result list grouped by
  type (Projects / Tasks / Contacts / Organisations / Actions).
- **Keyboard shortcut**: `Cmd/Ctrl+K` (or `Cmd/Ctrl+/`) toggles the
  palette from any dashboard route.
- **Topbar trigger**: a "Search… ⌘K" button sits left of the
  assistant + theme toggle so the shortcut is discoverable; mobile
  shows just the search icon.
- **Quick actions**: New project / New task / New contact +
  Schedule / Kanban quick-jumps. Empty-query state shows actions
  first then top 5 projects.
- **Search** is client-side and incremental against pre-loaded
  data (one round-trip per type, on first open). Arrow keys
  navigate, Enter selects, Esc closes.
- **Deep-link from palette**: New-X actions push `?new=1` and the
  target list page reads it on mount, opens the create modal, then
  cleans the URL via `router.replace`.

Footer of the palette shows the navigation hints (↑↓ navigate, ↵
select, Esc close) plus the live result count.

## [1.6.36] — 2026-05-01

### Added (drag-to-reschedule on the Gantt)

The `/dashboard/schedule` Gantt was read-only since v1.6.7 — bars
ran from `createdAt` to `dueDate` and clicking a bar navigated to
the project. Now bars are **draggable**: pointer-down on a bar
starts a drag, pointer-move shows a live preview translation, and
pointer-up commits the new due date via `PATCH /projects/:id`.

- `<Gantt>` takes a new optional `onReschedule(projectId, newDate)`
  callback. If omitted, bars stay read-only (back-compat).
- The dragging bar shows a primary-coloured ring + shadow + replaces
  its status text with `→ MMM d` so the user sees the target date.
- Days delta is computed from pixel-displacement using a
  `ResizeObserver` on the timeline container so the math stays correct
  on viewport resize during drag.
- Pointer capture means the drag survives leaving the bar's
  hit-rect — drag a bar 200 days out and it just keeps going.
- Optimistic update: the local `projects` state shifts immediately on
  pointer-up. PATCH happens in the background. On failure, the row
  reverts and a destructive toast explains.
- Completed projects + bars without a due date stay non-draggable
  (cursor stays as pointer, not grab).
- Click-vs-drag heuristic: if the user moved the bar at all, the row's
  navigate-to-project click is suppressed. Click without moving still
  navigates.

## [1.6.35] — 2026-05-01

### Added (project detail page snapshot card)

`/dashboard/projects/[id]` now opens with a `<ProjectSnapshot>` card
summarising the project's task work — sits above the task list so
the project's shape reads at a glance:

- Three quick stats: **Total tasks**, **Completed**, **Overdue**
  (overdue stat goes rose-tinted when > 0).
- **Completion progress bar** with `X% · 12 of 27 done` label.
- **Status donut** (Pending / In progress / Waiting for client /
  Completed / Cancelled) with coloured legend chips.
- **Priority bar** (Low / Medium / High / Urgent).
- Empty state: when the project has no tasks, renders a friendly
  "Add a task below to start tracking progress" card instead of
  empty SVGs.

Reuses the same Recharts setup, theme-aware tooltips, and colour
vocabulary as the dashboard `<ProjectCharts>` so the dashboard and
detail page feel like one product.

## [1.6.34] — 2026-05-01

### Changed (Documents + Users finish the toolbar sweep)

The two remaining list pages now share the same `<ListToolbar>` UX
that landed in v1.6.31–33:

**Documents** —
- File-type filter (Images / PDFs / Spreadsheets / Other) with
  coloured dots
- Project filter (derived from loaded documents; hidden when only
  one project is present in the data)
- Sort by Newest first (default) / Oldest / Name A–Z / Name Z–A /
  Largest first / Smallest first
- Result count line

**Users** —
- Role filter (Admin / Manager / Staff / Client) with coloured dots
- State filter (Active / Inactive / Both)
- Sort by Last name A–Z (default) / First name / Email / Newest /
  Oldest / Recently logged in
- Result count line

This completes the v1.6.31–34 sort+filter sweep. Every list page in
the dashboard now offers identical search, filter chip, clear-all,
and sort controls.

## [1.6.33] — 2026-05-01

### Changed (Contacts + Organizations adopt the toolbar)

`/dashboard/contacts` and `/dashboard/organizations` were the last
two list pages still using ad-hoc filter buttons. They now share the
same `<ListToolbar>` as Projects and My Tasks:

**Contacts** —
- State filter (Active only / Inactive only / Both) replaces the
  three-button row that was easy to mis-click.
- Organisation filter (derived from loaded contacts; hidden if
  there's only one organisation in the data).
- Sort by Last name A–Z (default) / First name / Newest / Oldest /
  Recently updated.

**Organizations** —
- Type filter (Agencies / Businesses / Individuals) replaces four
  buttons.
- State filter (Active / Inactive / Both) replaces three buttons.
- Sort by Name A–Z (default) / Newest / Oldest / Recently updated.
- Result count line below toolbar.

Net: every list page in the dashboard now offers the same UX —
search, filter chips with clear-all, and explicit sort.

## [1.6.32] — 2026-05-01

### Changed (My Tasks list adopts the toolbar)

`/dashboard/my-tasks` now uses the same `<ListToolbar>` shipped in
v1.6.31. The previous "Filters" card with two `<Select>` dropdowns
+ a search input is gone:

- **Status / Priority / Project / Created** filter dropdowns with
  coloured dots in the menu (status + priority); Project list is
  derived from whatever's loaded so it doesn't render an empty menu.
- **Sort by** Due-soon (default), Newest, Oldest, Recently updated,
  Priority, Title.
- Active-filter chip row + Clear-all link.
- "12 of 27 tasks match" result-count line.

### Notes

The /dashboard/kanban view stays as-is (it's a board, not a list);
its filter UX may get a separate pass if needed.

## [1.6.31] — 2026-05-01

### Added (list views — sort, filter, active-chip toolbar)

Every list page (Projects first; Tasks/Contacts/Orgs/Documents/Users
follow in v1.6.32–34) was missing **sort** entirely and only had ad-hoc
filter controls (a native `<select>` here, a click-the-stat-card filter
there). Added a reusable toolbar that gives every list the same
modern UX:

- **`<ListToolbar>`** (`components/ui/list-toolbar.tsx`) — composable
  search + filter dropdowns + sort dropdown, plus a row of
  active-filter chips with one-click removal and a Clear-all link.
  Active filters get a tinted primary trigger so it's obvious at a
  glance which controls are doing something.
- **`lib/list-controls.ts`** — `compareValues()` (null-safe, locale-
  aware, date/number/string-aware), `priorityRank()` /
  `statusRank()` for enum sorting, `withinDateRange()` + the
  `DateRangePreset` set (Today / 7d / 30d / 90d / 365d / All).

### Changed (Projects page consumes the toolbar)

- `/dashboard/projects` now exposes:
  - **Status** filter (in addition to the stat-card click pattern)
  - **Priority** filter (Urgent / High / Medium / Low — coloured dots
    in menu)
  - **Assignee** filter — derived from whatever assignees are present
    on loaded projects (no extra `/users` round-trip)
  - **Created** date range filter
  - **Sort by** Newest / Oldest / Recently updated / Due soon /
    Priority / Title / Project number
- Active-filter chip row appears below the toolbar when any filter is
  set; each chip removes its own filter on click, plus a Clear-all link.
- Result count line ("12 of 27 projects match") replaces the silent
  filtered-count behaviour.
- The dated `<select>` priority dropdown + dead "Filters" button are
  gone.

### Notes

- Backend version bumped in lockstep; no backend code changes.
- The same toolbar is wired up across Tasks / Contacts / Orgs /
  Documents / Users in v1.6.32–34 so the UX is consistent everywhere.

## [1.6.30] — 2026-04-30

### Changed (Settings + Documents polish)

**Settings page (`/dashboard/settings`)** — was showing a static
"profile information" form whose Save button did nothing, plus an
inline change-password form duplicating `/auth/change-password`,
plus three notification toggles that the backend doesn't act on.

- Profile form now wires against `PATCH /users/:id` and updates the
  Zustand auth store on success — the change is reflected immediately
  in the topbar avatar + sidebar without a refresh.
- Email field shows a quiet "SSO at auth.unicorncommander.ai is the
  source of truth" hint so users don't expect a federated update.
- Inline change-password form removed; a tinted "Change password"
  link to `/auth/change-password` replaces it.
- Notifications card marked **Coming soon** with `opacity-60
  pointer-events-none` rather than presenting non-functional toggles.
- Section headers use the standard tinted icon-well pattern
  (`iconWellClass("blue")` for User, `"rose"` for Shield, `"amber"`
  for Bell, `"violet"` for the admin Shield) — same as the rest of
  the app.

**Documents page (`/dashboard/documents`)** —

- Stat cards (Total / Total Size / PDFs / Images) replaced the
  numerals-on-blank-card layout with the dashboard-style tinted
  icon-well + count pairing (blue Files, violet HardDrive, rose
  FileText, emerald Image).
- Document rows now carry the per-project colour stripe (left border
  + faint `cardWash`) — same hashed palette as kanban / contacts /
  organizations. A 50-document inbox stops looking like an undifferent-
  iated list.
- File-type icons swept off solid `text-red-600` / `text-green-600`
  to tinted dark-mode-aware variants. Trash button matches.

### Notes

No backend code changes; `/users/:id` PATCH already existed and is
unchanged. Backend version bumps in lockstep so the deploy pipeline
ships both halves cleanly.

## [1.6.29] — 2026-05-01

### Changed (modernise the badge / pill aesthetic)

The kanban + dashboard My Tasks + TaskCard + organizations type
labels were using **solid saturated fills** for status / type pills
(`bg-emerald-500 text-white`-style). That was the v1.6.18 Hive-style
attempt — looks dated in 2025 (more 2018 Bootstrap or early
Material). Modern SaaS (Linear, Notion, Stripe Dashboard) uses
**tinted backgrounds with matching text** for non-CTA labels, saving
solid fills for chart elements and primary actions.

**Sweep:**

- `statusSolidClass` is gone everywhere — callers use the existing
  `statusBadgeClass` (tinted, `bg-X-500/15 text-X-700 dark:text-X-300`).
  Touched: kanban task cards, dashboard My Tasks rows, shared
  `TaskCard` component, gantt import (still imported but inert).
- **Pill className polish** — dropped the dated `uppercase
  tracking-wide font-semibold text-[10px]` styling. Now
  `rounded-md px-1.5 py-0.5 text-[10.5px] font-medium` — readable,
  refined, sentence-case.
- **`getOrganizationTypeBadgeColor`** now returns tinted strings
  (violet-500/15, emerald-500/15, amber-500/15, zinc-500/15) instead
  of solid `-500/-600 text-white` blocks.
- **Organizations page filter buttons** (Agencies / Businesses /
  Individuals + Active / Inactive) — active states are now tinted
  pills matching their type colour, instead of solid green/red
  blocks. Same modern look as the rest of the app.

### Kept solid (deliberately)

- **Gantt project bars** stay solid — they're chart elements, not
  labels. Solid fill is correct on a busy timeline.
- **Per-project number chips** (e.g., `PROJ-2026-000014`) stay
  tinted with a saturated dot — same modern style as everywhere
  else, no change.

## [1.6.28] — 2026-05-01

### Changed (primary brand colour — indigo)

- **Primary is now indigo** (`#4f46e5` light, `#6366f1` dark) instead
  of the Linear-style monochrome near-black/near-white flip. Same
  approach as Linear, Notion, Vercel, Stripe Dashboard — saturated
  brand colour in both themes, just brightness-adjusted for
  background contrast. Reads as a real product CTA rather than "the
  most prominent neutral surface".
- **Vibrant theme keeps its violet primary** (`#a78bfa`) — the two
  hues are adjacent on the colour wheel, so Light/Dark indigo and
  Vibrant violet harmonize without clashing.
- **Legacy `--color-primary-blue` + `--color-primary-blue-hover`**
  tokens (kept for any straggler refs that didn't make it through
  earlier sweeps) updated to match the new indigo so they don't
  silently disagree.
- All `bg-primary text-primary-foreground` buttons, badges, and
  active states across the app pick this up automatically since
  they read from the CSS variable. No per-component changes needed.

### Visual identity check

This brings Project-Ops in line with what users expect from a
modern SaaS — coloured CTA, recognisable hue across themes, brand
consistency. Combined with the per-project rainbow tagging on the
data surfaces (kanban / projects / dashboard / contacts) the app
now reads as "branded indigo product with rainbow data" instead of
"monochrome reference design with rainbow accents."

## [1.6.27] — 2026-05-01

### Fixed (theme contrast — `bg-primary text-white` was invisible in dark)

The big "Add Contact" / "New Organization" buttons + the org type
labels + the contact-header icon-square were all using
`bg-primary text-white`. That works in light theme (primary is
near-black, text-white reads). In **dark theme** primary flips to
near-white, so the button became white-text-on-white-background and
disappeared. In **Vibrant theme** primary is violet, so white text
worked but the org type labels (which used `bg-accent text-white`,
where accent is amber) still missed the right contrast intent.

**Fixes (15+ instances across pages, modals, and shared components):**

- All `bg-primary text-white` → `bg-primary text-primary-foreground`.
  The `text-primary-foreground` token is dark-mode-aware (defined in
  `globals.css` `.dark` block as `#0b0b0d`), so it always contrasts
  with whatever `--color-primary` is in the active theme.
- All `hover:bg-primary-hover` → `hover:bg-primary/90`. The legacy
  `--color-primary-blue-hover` token was a hard-coded near-black
  that doesn't make sense as a hover state for a near-white primary
  in dark mode.
- All `hover:text-white` → `hover:text-primary-foreground`.
- **`getOrganizationTypeBadgeColor`** now returns explicit saturated
  colours per type (`bg-violet-600 dark:bg-violet-500` for AGENCY,
  emerald for BUSINESS, amber for INDIVIDUAL, zinc for the default).
  Solid saturated colour + white text reliably contrasts in light /
  dark / vibrant.

**Files swept:** `app/dashboard/{organizations,contacts,users}/page.tsx`,
`app/dashboard/organizations/[id]/page.tsx`, `app/dashboard/contacts/[id]/page.tsx`,
`app/client-portal/dashboard/page.tsx`, `components/organizations/hierarchy-tree.tsx`,
`components/comments/comment-item.tsx`, all four create/edit
contact + org modals, `lib/organizations-api.ts`.

## [1.6.26] — 2026-05-01

### Added (Contacts page polish)

- **Summary stats** at the top of `/dashboard/contacts` — Total /
  Active / With organization / Portal access. Same coloured-stripe +
  wash treatment the dashboard stat cards use. Computed client-side
  from the loaded contacts.
- **Per-org colour treatment on contact rows.** Contact linked to an
  organization → row picks up that org's hue (4px left stripe + faint
  `cardWash`), and the company column renders the org as a
  chip-with-dot pill in the matching colour. Visual link from
  contact → org → projects.
- **Inline `mailto:` + `tel:` actions.** Email + phone columns are
  now real anchors with hover affordance + `e.stopPropagation()` so
  the row click doesn't fire when tapped. Turns the contact list
  from a static read into a launcher.

## [1.6.25] — 2026-05-01

### Fixed

- **Compose forward of `PROJECT_OPS_ACCESS_LIST`.** v1.6.24 set the
  env var in the bigboy `.env` but never wired it through the
  docker-compose `environment:` block, so the backend started with
  the legacy fallback (visible in boot log as `PROJECT_OPS_ACCESS_LIST
  not set`). One-line compose addition. Now: `SSO access list: 3
  rules (source: env:PROJECT_OPS_ACCESS_LIST)`.

## [1.6.24] — 2026-05-01

### Added (SSO access gate)

- **SSO allowlist** in `backend/src/auth/access-list.ts` plus 9 specs
  (now 21 backend tests total). Driven by the new
  `PROJECT_OPS_ACCESS_LIST` env var. Format:
  `aaron@magicunicorn.tech:ADMIN, shafenkhan@users.noreply.github.com:ADMIN, *@magicunicorn.tech:STAFF`.

### Changed (intentional access semantics)

- **`validateKeycloakUser` now rejects unknown SSO emails.** Previous
  behaviour: any successful Keycloak SSO automatically JIT-provisioned
  a CLIENT-role Project-Ops user. New behaviour: the email must match
  an exact entry or domain wildcard in the allowlist; otherwise the
  request is rejected with `401 You are not authorized for Project-Ops`.
  This is the deliberate gate — Project-Ops is single-tenant internal
  today, so "has a uchub Keycloak account" is *not* the same as
  "should have a Project-Ops account."
- **Resolution order:** exact email > domain wildcard > deny. Match
  is case-insensitive. Malformed env entries (no role, unknown role)
  silently dropped, not crash-on-boot. Empty/missing email rejected.
- **Boot-time log** prints `SSO access list: N rule(s) (source: …)`
  so operators can confirm via `docker logs project-ops-backend` that
  the right env loaded vs. silent legacy fallback.
- **Legacy fallback** (Aaron + Shafen as ADMIN, everyone else
  rejected) kicks in if `PROJECT_OPS_ACCESS_LIST` is unset, with a
  clear log line. Misconfigured deploy can't accidentally lock you
  out, but it CAN'T accidentally let everyone in either.
- `.env.example` documents the new variable with an example.

### Multi-tenant question — answered, not implemented

Project-Ops is **single-tenant internal** today. All projects /
organizations / contacts / tasks / users live in one shared Postgres
schema with no `tenantId` column anywhere. RBAC is role-based, not
tenant-based.

Two future paths if Project-Ops becomes a SaaS product:
1. **Add a `Tenant` model + `tenantId` FK on every entity.** Scope
   every Prisma query by tenant. Add tenant signup + onboarding +
   billing (Lago is already in the suite). Real 1-2 week build with
   a meaningful migration.
2. **Boot config "default tenant"** so the existing internal usage
   keeps working under the new tenant model — minimum customer
   disruption when the multi-tenant code lands.

Logged here as a strategic question; today's allowlist is the
correct gate either way ("who can sign in at all" is independent of
tenancy).

## [1.6.23] — 2026-05-01

### Changed (CRM polish + Users SSO explainer)

- **Organization rows now carry per-org colour** — same
  `projectColorClasses` palette + 4px left stripe + faint card wash
  the kanban / projects / dashboard use. The icon-well next to each
  org name is tinted to its hue. So when you scan the orgs table you
  read each row as one entity, and when you click into a project that
  belongs to that org the visual identity carries through.
- **Users page gets an SSO model explainer banner.** Federated
  identity through `auth.unicorncommander.ai` (the uchub realm) means
  team members appear here *after* their first SSO login — no
  pre-creation step. New SSO users land as `CLIENT` by default;
  promote them on this page. The "Add User" button is for non-SSO
  password accounts (client-portal users invited via Contacts) and
  for pre-seeding accounts with a specific role.
- Contacts intentionally untouched — `Avatar` already gives each
  contact its own deterministic gradient, so per-contact colour
  treatment would be redundant. Contact rows continue to read as
  individual people.

### Known SSO gaps (logged, not fixed in this release)

- **`getDefaultRoleForEmail` is hard-coded** in
  `backend/src/auth/auth.service.ts` to `aaron@magicunicorn.tech` →
  ADMIN, `shafenkhan@users.noreply.github.com` → ADMIN, everyone else → CLIENT.
  Adding a third MU team member with a non-CLIENT default role
  currently means a code change. Should be a DB-driven allowlist or
  `INITIAL_ADMIN_EMAILS` env var. Worth ~30 min in a focused session.
- **No "invite by email" pre-provision flow** with a target role.
  The closest thing is the `/contacts/:id/invite` endpoint which
  creates a CLIENT-role password user. A proper "invite teammate"
  flow that pre-creates with role + waits for first SSO login would
  be the right pattern for onboarding.

## [1.6.22] — 2026-05-01

### Added

- **Schedule view** at `/dashboard/schedule` — a custom 2D Gantt
  master timeline of every project. New "Schedule" entry in the
  Workspace section of the sidebar. Built around our existing project
  colour palette so the timeline reads with the same visual identity
  as the kanban + dashboard:
  - **Coloured project bars** — every project gets its `solidBg` /
    `solidText` from `lib/project-colors.ts`. Same hue → same project.
  - **Status text** rendered inside the bar so the schedule
    communicates both *which project* and *what state*.
  - **Today indicator** — vertical dashed rose line spans the body
    rows, with a "TODAY" badge on top.
  - **Overdue ring** — projects past their due date get a rose
    ring-2 around the bar.
  - **Completed projects** rendered at 60% opacity so they recede
    visually without being hidden.
  - **Bars that overflow the visible window** get a polygon clip-path
    arrow on the relevant edge so it's clear "this continues outside
    the current view."
  - **Zoom**: 3 months / 6 months / Year / 18 months. Default 6 months.
  - **Navigation**: prev / today / next month buttons.
  - **Filters**: Status / Priority / Organization, collapsible.
  - **Click-through**: any row navigates to the project detail page.
  - **Empty state**: clear message when filters / window match nothing.
- **Project detail page header** — project number now renders as the
  same chip-with-dot pill used on the kanban + dashboard, picked up
  from `projectColorClasses(projectData.id)`. Visual consistency
  across every surface that names a project.

### Followups deliberately out of scope (logged for next session)

- **Drag to reschedule** the bars — needs a PATCH route on
  `/projects/:id` for `dueDate` + an optimistic-update layer in the
  Gantt component.
- **Task ribbons** stacked under each project bar — the data is
  there (`task.dueDate`), needs a second pass on the row layout.
- **Group-by-organization swimlanes** — group the project rows
  visually under their org for multi-client schedules.

## [1.6.21] — 2026-05-01

### Changed

- **My Tasks rows on the dashboard** now carry the per-project colour
  treatment — 4px coloured left stripe + faint card wash + chip-style
  project number pill + Hive-style solid status pill. Same visual
  vocabulary as the kanban + Recent Projects so a task reads as
  belonging to its project at a glance.
- **Shared `TaskCard` component** (`components/tasks/task-card.tsx`,
  used by `/dashboard/my-tasks` and a few other surfaces) rebuilt
  around the same colour treatment. Dropped the priority-based
  left stripe in favour of the project-based one — priority still
  appears as text colour, but the visual identity of the card now
  comes from "what project is this for", not "how urgent". Overdue
  tasks override to a rose stripe so the urgency signal stays
  unambiguous.

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
