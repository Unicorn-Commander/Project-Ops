# Git-Forge Integration — Design

**Task:** `952005b5-c154-4ad8-a0f6-1705eb8513b3`  
**Branch:** `dev/grok/t952005b5-git-forge-design`  
**Status:** Design ready for Aaron review  
**Author:** Grok (grok CLI)  
**Date:** 2026-07-22  
**Base:** `origin/main`

Surface commits, pull/merge requests, and delivery progress from self-hosted and hosted git forges **inside Project-Ops** (staff UI) and a **read-only-safe** CLIENT portal widget — without becoming a second forge UI, and without a suite-wide connector product.

---

## 1. Recommendation (TL;DR)

| Decision | Choice |
|---|---|
| Ownership | **PO-native Nest module** (`backend/src/git-forge/`) with a **provider interface** + thin adapters |
| First adapter | **Forgejo** (`git.unicorncommander.ai` and customer instances) |
| Later adapters | Gitea (near-identical API), GitHub (REST + App/PAT) |
| Suite connector | **Not recommended for v1** — see §2 |
| Auth | **Per-workspace** connection rows; **encrypted access tokens** (reuse `EMAIL_ENCRYPTION_KEY` AES-256-CBC pattern from `EmailService`) |
| Sync | **Inbound webhooks primary** + **scheduled poll backfill** |
| Schema this PR | **Design-only** — no migration until Phase 0 is approved |
| Scaffold this PR | Types + `GitForgeProvider` interface + stub `ForgejoAdapter` — **not wired into `AppModule`** |

---

## 2. PO-native module vs suite connector

### Option A — PO-native module + provider adapters (recommended)

```
┌─────────────────────────────────────────────────────────┐
│ Project-Ops                                             │
│  GitForgeModule                                         │
│    ├─ GitForgeService (workspace RLS, mapping, feed)    │
│    ├─ GitForgeProvider (interface)                      │
│    ├─ ForgejoAdapter  ← Phase 1                         │
│    ├─ GiteaAdapter    ← Phase 3 (fork of Forgejo path)  │
│    └─ GitHubAdapter   ← Phase 3                         │
│  Project ──1:N── GitRepoLink                            │
│  Workspace ──1:N── GitForgeConnection (encrypted token) │
└─────────────────────────────────────────────────────────┘
         ▲ webhooks / poll
         │
   Forgejo / Gitea / GitHub
```

**Why this wins for v1**

1. **Product surface is PO-shaped.** Commits map to *projects/tasks*; delivery progress sits next to Kanban and the client portal — not in a generic “integrations hub.”
2. **Existing seams match.** Suite tenancy (`WorkspaceContextService.runForUser`), outbound webhook patterns (HMAC secrets, delivery log), `@Cron` pollers (invoice-status), and field encryption (`EmailService` + `EMAIL_ENCRYPTION_KEY`) already live in PO.
3. **Provider interface keeps forges swappable** without a second service to deploy/operate. Forgejo and Gitea share ~the same REST surface; GitHub is one adapter.
4. **Dogfood path is immediate.** Magic Unicorn already ships repos on Forgejo (`git.unicorncommander.ai`). No new suite product gate.

### Option B — Suite connector (defer)

A shared “Integrations-Ops” / broker that mints forge tokens and fans events to PO, Meeting-Ops, etc.

**Defer because:**

- No multi-product consumer yet (only PO needs this feed now).
- Adds deploy surface, auth hop, and entitlement complexity before we have proven UX.
- Encrypted per-workspace tokens in PO are enough for self-host and hosted-Forgejo customers.

**Revisit if:** 2+ suite apps need the same forge connection, or Ops-Center wants a single “connected accounts” UX for forges.

### Decision

**Ship as a PO module with clean adapters.** Keep the provider port small and pure so a future suite connector can implement the same interface behind the wall without rewriting the feed/UI.

---

## 3. What to show — staff UI vs CLIENT portal

Principle: **staff sees engineering truth; clients see delivery progress.** Never leak private repo paths, raw diffs, branch protection, CI secrets, or internal forge URLs unless explicitly opted in.

### 3.1 Staff / human UI (ADMIN · MANAGER · STAFF)

| Surface | Content | Notes |
|---|---|---|
| Project detail → **Code** tab | Linked repos, default branch, last sync, connection health | Link/unlink requires MANAGER+ |
| **Activity feed** (project) | Recent commits (sha short, message subject, author, time, link-out) | Paginated; link opens forge in new tab |
| **Pull / merge requests** | Open + recently merged PRs/MRs: title, state, author, review state, target branch | Read-only in v1 (no merge-from-PO) |
| **Delivery progress** | Derived strip: commits on default branch since project start / last milestone; open PR count; last deploy tag *if* forge exposes releases | Purely informational |
| Task drawer (optional Phase 1.5) | Commits/PRs that mention `P-00xxx` / task UUID / conventional `refs #…` | Best-effort parsing |
| Workspace **Settings → Integrations → Git** | Connections CRUD, token paste (shown once as last-4), test connection, webhook URL + signing secret | ADMIN/MANAGER only |

**Not in v1:** code review UI, force-push, branch create, Actions runner control, blame, full diff viewer.

### 3.2 CLIENT portal (read-only safe)

CLIENT role already uses a separate controller path (`ClientPortalController` + `verifyClientRole`). Git data for clients must be a **curated projection**, never a passthrough of forge APIs.

| Show | Hide |
|---|---|
| “Delivery updates” card: **date + short human summary** (e.g. “3 updates shipped this week”) | Commit SHAs, branch names, internal paths |
| Optional: **public milestone labels** staff marked `clientVisible=true` | Author emails, forge usernames that aren’t client contacts |
| Optional: link to **public** release notes URL if set on the repo link | Private forge base URL, token health, webhook secrets |
| High-level PR state only if staff flags the PR `shareWithClient` (Phase 2+) | Open PR titles that may contain internal codenames (default off) |

**Default portal policy:** show only an aggregate **delivery pulse** derived from commits on the default branch of repos linked with `portalVisible=true`. No raw commit list unless a future setting enables it per project.

### 3.3 Delivery progress model (shared derivation)

```
deliveryProgress = {
  commitsLast7d: number,       // default branch only
  commitsLast30d: number,
  openPrCount: number,         // staff only by default
  lastActivityAt: ISO | null,
  headline: string,            // e.g. "Active this week" | "Quiet" | "Shipped recently"
}
```

Portal uses a **redacted** variant (`portalDeliveryProgress`) that drops `openPrCount` and never includes SHAs.

---

## 4. Auth — per-workspace encrypted tokens

### 4.1 Patterns already in PO

| Pattern | Where | Use for forges? |
|---|---|---|
| AES-256-CBC field encryption, `iv:hex` storage, key from `EMAIL_ENCRYPTION_KEY` (64-char hex) | `EmailService` SMTP password | **Yes — reuse algorithm + key** (or extract shared helper in Phase 0) |
| Secret shown once + last-4 hint thereafter | Webhooks (`secretHint`), PATs | **Yes** for access tokens in API responses |
| Env service bearer for cross-app poll | `ACCOUNTING_OPS_SERVICE_TOKEN` + invoice poller | Only if we ever need a system-wide dogfood forge — not the multi-tenant path |
| User bearer forward to sibling app | `HttpAccountingOpsClient` | N/A (forge is external, not suite SSO) |

### 4.2 Connection model (logical)

```
GitForgeConnection
  id, workspaceId
  provider: FORGEJO | GITEA | GITHUB
  baseUrl: string              # e.g. https://git.unicorncommander.ai
  displayName: string
  authType: PAT | GITHUB_APP   # v1 = PAT only
  accessTokenEnc: string       # AES-256-CBC, never returned
  tokenHint: string            # last 4
  scopesNote: string?          # free-text “repo:read” reminder
  status: ACTIVE | INVALID | DISABLED
  lastValidatedAt, lastError
  createdById, createdAt, updatedAt
```

- **One workspace may have many connections** (personal Forgejo + customer GitHub).
- **Tokens are workspace secrets**, not user secrets: any MANAGER can rotate; all staff reads use the workspace connection when loading a linked repo.
- **Encrypt/decrypt** via the same key material as email (`EMAIL_ENCRYPTION_KEY`). Prefer extracting `FieldEncryptionService` in Phase 0 so Email + GitForge share one implementation (today encryption is private on `EmailService`).
- API list/get: **never** serialize `accessTokenEnc`; only `tokenHint` + metadata.
- Create/rotate: accept plaintext token in write DTO only; store encrypted; return hint.

### 4.3 Webhook signing secrets

Inbound forge webhooks need a **per-connection or per-link shared secret** (Forgejo/Gitea HMAC; GitHub `X-Hub-Signature-256`).

- Generate server-side (`whsec_…` style, same entropy approach as `generateWebhookSecret`).
- Store encrypted or as high-entropy opaque (webhook signing secrets today are stored plaintext in `WebhookEndpoint.secret` — **prefer encrypting forge webhook secrets** at rest since they gate write of activity into PO).
- Verify on `@Public()` inbound route before any DB write; fail closed.

### 4.4 Least privilege

Document required token scopes per provider:

| Provider | Minimum scopes (read feed) |
|---|---|
| Forgejo / Gitea | `read:repository` (or full `read` PAT on org) |
| GitHub | classic: `repo` (private) or `public_repo`; fine-grained: Contents Read + Metadata Read + Pull requests Read |

No write scopes in v1.

---

## 5. Webhooks vs polling

### 5.1 Recommendation: **webhooks primary, poll as backfill**

| Mode | Role | Cadence |
|---|---|---|
| Inbound webhooks | Near-real-time commits, PR open/close/merge, push | Event-driven |
| Scheduled poll | Catch missed webhooks, initial backfill, health check | `@Cron` every 15–30 min per active link (jittered); mirror invoice poller tenancy pattern |
| On-demand sync | Staff “Refresh” button | Rate-limited |

### 5.2 Why not poll-only

- Dogfood Forgejo can push events immediately; poll-only feels stale next to live agent activity.
- Many customer forges allow webhooks; we should use them.

### 5.3 Why not webhook-only

- Misconfigured endpoints, firewall, and secret rotation all drop events.
- Accounting-Ops taught us: when the peer has no webhooks, poll works — keep the same dual pattern.
- Initial history fill needs list APIs anyway.

### 5.4 Inbound endpoint (Phase 1)

```
POST /api/v1/git-forge/hooks/:connectionId   @Public()  (signature-verified)
```

- Resolve connection by id; verify HMAC with stored secret; ignore unknown event types.
- Enqueue normalize → upsert activity rows **inside** `runInWorkspace(connection.workspaceId)` (no request user — same idea as webhook listener / invoice poller).
- Idempotency: unique `(workspaceId, provider, externalEventId)` or `(repoLinkId, sha)` for commits.

### 5.5 Poller (Phase 1)

- Iterate **active** `GitRepoLink` rows via control-plane workspace list (same structure as `InvoiceStatusPoller`).
- Per link: decrypt connection token → `provider.listCommits` / `listPullRequests` since `cursor` → upsert.
- Skip when token missing/invalid; mark connection `INVALID` on 401/403.

### 5.6 Network policy

**Adapters must not call the network without a decrypted token + baseUrl.** Stub/scaffold returns empty or throws `GitForgeNotConfiguredError`. Timeouts (e.g. 10s), no redirect to non-https (except loopback dev).

---

## 6. Data model (Phase 0 — design only, no migration in this PR)

Keep tables few. Prefer **normalized activity** over caching full forge payloads forever.

### 6.1 Proposed tables

```prisma
enum GitForgeProviderKind {
  FORGEJO
  GITEA
  GITHUB
}

enum GitForgeConnectionStatus {
  ACTIVE
  INVALID
  DISABLED
}

model GitForgeConnection {
  id              String   @id @default(uuid())
  workspaceId     String
  provider        GitForgeProviderKind
  baseUrl         String
  displayName     String
  accessTokenEnc  String
  tokenHint       String
  webhookSecretEnc String?
  status          GitForgeConnectionStatus @default(ACTIVE)
  lastValidatedAt DateTime?
  lastError       String?
  createdById     String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  repoLinks       GitRepoLink[]

  @@index([workspaceId])
  @@map("git_forge_connections")
}

model GitRepoLink {
  id              String   @id @default(uuid())
  workspaceId     String
  connectionId    String
  projectId       String
  owner           String   // org or user
  repo            String
  defaultBranch   String   @default("main")
  externalRepoId  String?  // forge numeric/string id when known
  htmlUrl         String?
  portalVisible   Boolean  @default(false)
  enabled         Boolean  @default(true)
  lastSyncedAt    DateTime?
  syncCursor      String?  // opaque provider cursor / since ISO
  createdById     String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  connection      GitForgeConnection @relation(...)
  // project relation optional in Prisma; still index projectId

  @@unique([workspaceId, projectId, connectionId, owner, repo])
  @@index([workspaceId])
  @@index([projectId])
  @@index([connectionId])
  @@map("git_repo_links")
}

enum GitActivityKind {
  COMMIT
  PULL_REQUEST
  RELEASE
}

model GitActivity {
  id              String   @id @default(uuid())
  workspaceId     String
  repoLinkId      String
  projectId       String
  kind            GitActivityKind
  externalId      String   // sha or PR id
  title           String   // commit subject or PR title
  state           String?  // open/merged/closed for PRs
  authorName      String?
  authorEmail     String?  // staff only; strip for portal
  occurredAt      DateTime
  htmlUrl         String?
  clientVisible   Boolean  @default(false)
  rawSummary      Json?    // small normalized blob, not full payload
  createdAt       DateTime @default(now())

  @@unique([workspaceId, repoLinkId, kind, externalId])
  @@index([workspaceId, projectId, occurredAt])
  @@index([repoLinkId, occurredAt])
  @@map("git_activities")
}
```

### 6.2 RLS / tenancy

- All three tables: `workspaceId NOT NULL`, included in suite RLS scoped tables (same migration pattern as webhooks/automations).
- Services: only `workspaceContext.runForUser` / `runInWorkspace`; never raw `this.prisma.gitActivity` outside the chokepoint.
- Inbound webhook + cron: `runInWorkspace` (system path).

### 6.3 Why no migration in this PR

Schema is simple but **not yet approved** (token encryption helper extraction, `clientVisible` defaults, unique keys). Landing a migration before review risks a second migration on day one. **Phase 0 PR = schema + encryption helper + empty module registration.**

---

## 7. Provider interface (scaffold)

See `backend/src/git-forge/`:

- `types.ts` — DTOs for commits, PRs, repo identity, connection credentials.
- `git-forge.provider.ts` — `GitForgeProvider` abstract port + injection token.
- `providers/forgejo.adapter.ts` — **stub**: validates credentials present; **no HTTP** until token + baseUrl supplied and a future `enabled` path is implemented.
- `git-forge.module.ts` — module shell; **not imported by `AppModule` yet** (zero runtime impact).

Design target for the live adapter (Phase 1):

```ts
abstract class GitForgeProvider {
  abstract readonly kind: GitForgeProviderKind;
  abstract testConnection(creds: GitForgeCredentials): Promise<GitForgeConnectionTestResult>;
  abstract listCommits(creds, repo, opts: { branch?; since?; limit? }): Promise<GitCommit[]>;
  abstract listPullRequests(creds, repo, opts: { state? }): Promise<GitPullRequest[]>;
  abstract parseWebhook(headers, rawBody, secret): GitWebhookEvent | null;
}
```

Registry: map `provider` enum → adapter instance (simple `Map` or switch in `GitForgeService`).

---

## 8. API surface (Phase 1 sketch)

Staff (JWT + workspace membership + roles):

| Method | Path | Role |
|---|---|---|
| GET/POST | `/git-forge/connections` | MANAGER+ write; STAFF+ read |
| POST | `/git-forge/connections/:id/test` | MANAGER+ |
| POST | `/git-forge/connections/:id/rotate-token` | MANAGER+ |
| GET/POST/DELETE | `/git-forge/projects/:projectId/repos` | MANAGER+ write |
| GET | `/git-forge/projects/:projectId/activity` | STAFF+ |
| GET | `/git-forge/projects/:projectId/delivery-progress` | STAFF+ |
| POST | `/git-forge/projects/:projectId/sync` | STAFF+ (rate limit) |

Public:

| Method | Path |
|---|---|
| POST | `/git-forge/hooks/:connectionId` |

Client portal:

| Method | Path |
|---|---|
| GET | `/client-portal/projects/:id/delivery` | CLIENT only; redacted |

MCP (Phase 1.5+): `list_project_git_activity` read tool — optional; keep out of critical path.

---

## 9. Phased plan

### Phase 0 — Schema + encryption seam (implementation after design approval)

- [ ] Extract or duplicate field-encryption helper shared with email (prefer extract `FieldEncryptionService`).
- [ ] Prisma models + migration + RLS policies for `git_forge_*` tables.
- [ ] Register `GitForgeModule` in `AppModule` (still no external calls).
- [ ] Gate: `prisma validate` + unit tests for encrypt/decrypt + provider stub.

### Phase 1 — Forgejo commits feed (staff)

- [ ] Live `ForgejoAdapter` (REST: `/api/v1/repos/{owner}/{repo}/commits`, PRs, user).
- [ ] Connections + repo-link CRUD UI (Settings + project Code tab).
- [ ] Webhook receiver + 15–30 min poller + activity list API.
- [ ] Staff project activity panel (commits + open PRs).
- [ ] Dogfood: link P-00085 (or a pilot project) to a Forgejo repo on `git.unicorncommander.ai`.

### Phase 2 — CLIENT portal widget

- [ ] `portalVisible` on repo links; redacted delivery endpoint.
- [ ] Portal card: headline + 7/30 day counts; no SHAs by default.
- [ ] Optional `clientVisible` flag on individual activities / releases.
- [ ] Copy review: client-safe empty states (“No public delivery updates yet”).

### Phase 3 — GitHub + Gitea

- [ ] `GiteaAdapter` — mostly Forgejo-compatible; verify path differences.
- [ ] `GitHubAdapter` — REST + signature verification; PAT first, GitHub App later if needed.
- [ ] Provider-specific UI hints (scopes, webhook setup deep links).
- [ ] Hardening: rate-limit headers, secondary rate limits, large monorepo caps.

### Explicit non-goals (until requested)

- Merge/rebase from PO  
- Bidirectional issue sync as a full GitHub Issues clone  
- CI log streaming  
- Suite-wide connector product  

---

## 10. Security & compliance checklist

- [ ] Tokens encrypted at rest; never logged; never in audit `metadata` plaintext.
- [ ] Webhook route: signature required; body size cap; timing-safe compare.
- [ ] SSRF: allow only `https` baseUrl (http loopback in dev); block link-local/metadata IPs on adapter fetch.
- [ ] CLIENT redaction tested (unit + one e2e).
- [ ] RLS: cross-workspace activity invisible.
- [ ] Rotate token invalidates prior ciphertext only after re-encrypt (standard).
- [ ] No secrets in design branch commits (scaffold has none).

---

## 11. Open questions for Aaron

1. **Encryption key:** reuse `EMAIL_ENCRYPTION_KEY` vs introduce `FIELD_ENCRYPTION_KEY` alias (same bytes, clearer name)? Recommendation: **alias both to one env** during extract, document rename path.
2. **Portal default:** aggregate pulse only (recommended) vs optional raw commit subjects for selected clients?
3. **Task auto-link:** parse conventional commit / `P-00xxx` in messages in Phase 1, or wait?
4. **Dogfood connection:** org-level bot PAT vs user PAT for `git.unicorncommander.ai`?
5. **GitHub App** (installation tokens) in Phase 3 or PAT-only indefinitely for self-serve simplicity?

---

## 12. Acceptance for *this* design task

- [x] Design doc answers module vs connector, UI split, auth, webhooks/poll, phased plan.
- [x] Minimal additive scaffold under `backend/src/git-forge/` (not wired; no network without token).
- [x] No migration, no deploy, no secrets, no force, no main.
- [x] Branch pushed for review: `dev/grok/t952005b5-git-forge-design`.

**Next human step:** Aaron reviews §2/§3/§11 → approve Phase 0 schema PR.

---

## 13. File map (this branch)

| Path | Purpose |
|---|---|
| `docs/designs/GIT-FORGE-INTEGRATION.md` | This document |
| `backend/src/git-forge/types.ts` | Shared types |
| `backend/src/git-forge/git-forge.provider.ts` | Provider port + token |
| `backend/src/git-forge/providers/forgejo.adapter.ts` | Stub Forgejo adapter |
| `backend/src/git-forge/git-forge.module.ts` | Nest module shell (unwired) |
| `backend/src/git-forge/index.ts` | Barrel exports |
