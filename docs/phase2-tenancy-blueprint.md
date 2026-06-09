# Project-Ops Phase 2 Tenancy — Implementation Blueprint

Branch: `feat/suite-tenancy-rebase`. Produced by the decomposition workflow 2026-06-09.
Governing spec: `SUITE-IDENTITY.md` (binding). Phase 1 (Workspace/Membership models, RLS roles,
GUC chokepoint) already merged + green (commit `c8ee274`), flag OFF.

## Ground truth (verified against code; corrects earlier specs)
- Seam exists + works: `WorkspaceContextService.runForUser(user, (tx) => …, requestedWorkspaceId?)`
  resolves→authorizes→pins GUC via `prisma.withWorkspace`. Reference impl = `backend/src/time-tracking/`.
- Controller pattern: `(@CurrentWorkspace() workspaceId, @CurrentUser() user, …dto)` → `service.method(workspaceId, user, …)`.
- `WorkspaceContextService` + `MembershipService` are NOT `@Global` → each module lists them in its own
  `providers`. This is what makes per-module work touch **disjoint files**.
- Feature flag path: `backend/src/common/workspace/feature-flags.ts` (`PROJECT_OPS_TENANCY_ENABLED`, default OFF).
- RLS already covers 9/9 wire-through tables (migration `20260603051046_suite_tenancy_rls_roles`).
  `triage_proposals` is NOT scoped + has no `workspaceId`. `personal_access_tokens` is intentionally no-RLS (app-enforced).
- `withWorkspace` already fails closed on empty workspaceId.
- uc-registry is BUILT (`uc-ops-center/uc-registry`, `POST /workspaces`) but NOT deployed; PO never calls it.

## Phases (ordered)
### A — SHARED-INFRA (single-threaded; blocks everything)
- A1: `AuditService`/`CreateAuditLogDto` accept optional `workspaceId` (9 modules call `audit.log()`).
- A2: ONE Prisma schema edit + ONE migration: add `workspaceId` to `TriageProposal` (+ `@@unique([workspaceId, sourceType, sourceActionItemId])`, index) and `PersonalAccessToken` (nullable, index); migration backfills both, adds `triage_proposals` to scoped_tables + identical `workspace_isolation` RLS policy; NO RLS on PATs. (Fold in `Contact` → `@@unique([workspaceId, email])` if approved.)
- A3: GATE 1 — `prisma validate && prisma generate && nest build` green before cutting worktrees.

### B — PER-MODULE WIRE-THROUGH (parallel worktrees, disjoint files)
Per unit: module adds the two providers; controller adds `@CurrentWorkspace/@CurrentUser` + `@UseGuards(WorkspaceMembershipGuard)`; service wraps every query in `runForUser(user, tx => …, workspaceId)` — all reads/writes via `tx`, never `this.prisma`; pass `workspaceId` to `audit.log()`.
- B1 Projects (generateProjectNumber inside the create tx; R1 findOne scoping) [med]
- B2 Tasks (create: createdById→user) [high]
- B3 Comments [med]  · B4 Documents (MinIO I/O outside tx, metadata inside) [med]
- B5 Organizations (thread `tx` through recursive helpers) [high]
- B6 Contacts (email-uniqueness check workspace-scoped; R2) [high]
- B7 Dashboard (move each `Promise.all` INSIDE one runForUser; R4) [high]
- B8 Audit reads (after A1; owns read-method refactor) [med]
- B9 Triage (after A2 + B1/B2; `getProjectIndex(tx)`; add workspaceId to ProjectIndex cache key — R5) [high]

### C — CROSS-CUTTING (serial tail)
- C1 PAT scoping: `pat.service/controller`, `jwt-auth.guard` (403 on PAT.workspaceId vs resolved mismatch), `mcp.service/controller` fail-closed at tool chokepoint.
- C2 `auth.service` login/profile return `workspaces[]` (blocks C3).
- C3 Frontend switcher (mirror MO OrgContext): SINGLE `window.fetch` override chaining `X-Workspace-Id` AFTER token injection — NO second wrap (R7). Nesting Theme→Auth→Workspace→Toaster.
- C4 Seed migration + `seed:phase2` script: rebrand bootstrap `0190a000-…-b007` → "Magic Unicorn"; create "Brightwater Labs"; Memberships: aaron@magicunicorn.tech OWNER@MagicUnicorn, shafenkhan@users.noreply.github.com MANAGER@GFL (reconcile PROJECT_OPS_ACCESS_LIST; R6).

### D — TESTS + GATES
- D1 §9 RLS integration tests run as `project_ops_app` (NOBYPASSRLS) w/ flag ON: no-GUC→zero rows; cross-workspace blocked; PAT W1→W2=403; Brigade aud mismatch=401; HIPAA→strict ratchet.
- D2 GATE 3 final: prisma validate + nest build + unit suite + D1 green.

### E — REGISTRY (separate runbook; gates the PRODUCTION flip only, NOT in this PR)
Deploy uc-registry (persistent RS256 key); add a PO registry client calling `POST /workspaces` (Idempotency-Key) on workspace creation; lazy-pull mirror on cache miss. HARD GATE: do not flip prod `DATABASE_URL`→`project_ops_app` until every Workspace-creation path calls the registry (else new workspaces get NULL id → invisible under RLS).

## Top risks
R0 fail-closed is silent (grep-gate: no `this.prisma.<scopedModel>` outside runForUser in the 9 modules) ·
R1 projects.findOne/by-number scoping (default: scoped) · R2 Contact email global-unique → per-workspace ·
R3 audit.log NULL workspaceId · R4 dashboard Promise.all outside tx · R5 triage ProjectIndex cache key ·
R6 membership seed vs access-list · R7 frontend double fetch-wrap · R8 multiple migration heads (A2/C4/D1 each ONE migration).

## Deploy sequence
Build → flip + verify on magicunicorn.dev (internal/testing; Magic Unicorn + Brightwater Labs tenants) →
onboard Shafen (MANAGER@GFL) → deploy uc-registry + wire (Phase E) → promote to unicorncommander.ai (prod SaaS).
