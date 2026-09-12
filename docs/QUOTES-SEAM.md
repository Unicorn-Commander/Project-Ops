# Quotes & Proposals — the Project-Ops execution seam

Lane L4 of the suite's Quotes & Proposals contract
(`QUOTES-CONTRACT-v1.md` §3 "Project-Ops", plus Amendment 01 A7/A9/A14/A15/A16/A17).
Customer-Ops owns the quote. When a quote is **accepted**, Customer-Ops emits
`quote.accepted`; Project-Ops turns it into the execution objects it already
owns — a project, milestone tasks, billing fields, the accepted PDF as a
document — and renders a **Quote panel** by reading the quote back from
Customer-Ops at request time. Project-Ops never stores a second copy of the
lines and never re-derives amounts from tasks or time.

```
Customer-Ops ──quote.accepted──▶ POST /api/v1/federation/quotes/accepted ──▶ project + tasks + billing + PDF
                                                                            metadata.quote = ids only
Project page / client portal ──▶ GET /projects/:id/quote ──▶ GET {Customer-Ops}/api/quotes/:id/summary?project_ops_project_id=…
                                 (degrades to the cached summary when Customer-Ops is not connected)
```

Code: `backend/src/quotes/` (ingress, panel route), `backend/src/customer-ops/`
(read-through client + panel builder + CLIENT mask), the portal route in
`backend/src/client-portal/`, `withProjectQuote` in `backend/src/mcp/mcp.tools.ts`,
and `frontend/components/project/quote-panel.tsx`.

---

## 1. Inbound: `POST /api/v1/federation/quotes/accepted`

### Who may call it

Only the **`customer-ops` federation actor**. The call is authenticated by a
Brigade token exchange minted **for Project-Ops**:

| Claim | Value |
|---|---|
| `iss` | a `BRIGADE_TRUSTED_ISSUERS` issuer |
| `aud` | `project-ops` (`BRIGADE_EXPECTED_AUDIENCE`) |
| `act.client_id` | `customer-ops` |
| `sub` | the Customer-Ops service account (NOT an email — an email `sub` is a human, routed to the human path and rejected here) |
| `workspace_id` | the Project-Ops workspace the project must land in |

`JwtStrategy` resolves that token to a synthetic federation principal;
`FederationActorGuard` elevates it **only** if `customer-ops` is on
`PROJECT_OPS_FEDERATION_ACTORS` (CSV; default empty = zero federation trust)
**and** the handler is `quoteAccepted` (route scope — an allow-listed
`meeting-ops` is not elevated here). The guard stamps `req.workspaceId` from
the **Brigade-vouched claim**. `X-Workspace-Id` is a hint elsewhere in the
suite; on this route it is never read — the claim is the boundary.

There is no human path: an ADMIN token gets `403 FEDERATION_ACTOR_REQUIRED`.
"Retry federation" is a Customer-Ops action that re-enters through the same
actor (the call is idempotent, see below).

### Payload

Money is **integer cents**, computed by Customer-Ops through its single
`computeQuote` path (A4). The global `ValidationPipe` runs with
`whitelist + forbidNonWhitelisted`: an unknown key anywhere is
`400 VALIDATION`. Internal notes, the split rule and direct costs are not
part of this contract and are therefore rejected by construction (§2.6, A3).

| Field | Type | Notes |
|---|---|---|
| `customer_ops_quote_id` | string | Customer-Ops `quotes.id`. **Idempotency key with `version`.** |
| `number` | string | `Q-YYYY-NNNN` |
| `version` | int ≥ 1 | the accepted `version_no` |
| `title` | string | → `project.title` |
| `share_url` | URL | the public share link |
| `client_name` | string | → `project.clientName` |
| `contact_id` | string? | a **Project-Ops** Contact id. Linked only if it resolves inside the target workspace; otherwise the project is created unlinked (`contact_linked: false`), never an error. |
| `currency` | ISO 4217 | v1 = 2-decimal currencies only; `JPY`, `KWD`, … → `400 UNSUPPORTED_CURRENCY` (A17) |
| `billing.one_time_total_cents` | int | Σ accepted one-time lines |
| `billing.milestone_total_cents` | int | Σ accepted milestone lines |
| `billing.deposit_cents` | int? | the deposit Customer-Ops computed from the per-line `payment_split` (A5). **Accepted and echoed, not stored**: the deposit is Accounting-Ops' paper (§3), and the Quote panel reads it live off the Customer-Ops summary rather than keeping a copy that can go stale. |
| `billing.recurring[]` | array? | the accepted recurring lines: `{ interval: month\|quarter\|year, amount_cents, label? }`. Project-Ops creates no task and no schedule for them (§3: recurring lines are narrative in `schedule_text` in v1); it blends them into the one cached figure below. Absent/empty = no recurring commitment. |
| `billing.recurring_monthly_cents` | int? | optional pre-blended monthly equivalent, for a sender without the per-line breakdown. **`recurring[]` wins when both are present** (one compute path, A4). The stored figure is always `month + quarter/3 + year/12`, rounded — the same formula as `computeQuote`'s `monthly_equivalent_cents`, so the cached tile and the live tile agree. |
| `billing.hourly_rate_cents` | int? | the rate of the line flagged `hourly.primary` (A14), already resolved by Customer-Ops → `defaultBillRate` |
| `billing.schedule_text` | string | → `billingNotes = "Quote <number> v<version>: <schedule_text>"` |
| `billing.version_no` | int? | the version the billing block was computed from; must equal `version` (`400 VERSION_MISMATCH` otherwise) |
| `lines[]` | array | `kind` ∈ `one_time\|milestone\|recurring\|hourly\|option\|included\|excluded`, `label`, `acceptance_criteria_md?`, `estimated_hours?`, `weeks?`, `position`, `selected?` (default true), `option_group?`, `customer_ops_line_id?` |
| `lines[].amount_cents`, `lines[].payment_split`, `lines[].payment_parts` | int / int[] / int[] | **Accepted and ignored.** Project-Ops does no part arithmetic — Accounting-Ops owns every invoice (§3) — but `forbidNonWhitelisted` makes an *undeclared* key a hard `400`, so without these the one `quote.accepted` projection that already serves the Accounting-Ops seam would federate nothing here. Declared so L1 emits ONE payload for both seams. Still validated: `payment_split` must be integers summing to 100 (A20). A20's rule holds trivially — the exact parts are never re-rounded because they are never read. |
| `pdf` | object? | `{ url \| base64, file_name }` — the accepted PDF. May arrive on a retry; attached once. |
| `schedule_ids` | string[]? | Accounting-Ops schedule ids (A14). May arrive on a later call; merged idempotently. |
| `accepted_at` | ISO date? | informational |

### What gets created (first call for a `(workspace, quote id, version)`)

| Object | Fields |
|---|---|
| **Project** | `title`, `clientName`, `contactId` (when it resolves), `description = "Created from accepted quote <number> v<version> (Customer-Ops)."`, `status NEW`, `billingAmount = budgetAmount = one_time + milestones`, `defaultBillRate` from `hourly_rate_cents` (null when absent), `billingNotes` as above, `metadata.quote = { customer_ops_quote_id, number, version, share_url, schedule_ids[] }`, `metadata.quoteSummary = { title, currency, status: "accepted", totals: { one_time_total_cents, milestone_total_cents, recurring_monthly_cents } }` (the small cached summary — every field is CLIENT-safe by construction) |
| **Tasks** | one per line with `kind ∈ {one_time, milestone}` **and** `selected !== false`, ascending `position` (stable): `title = label`, `description = acceptance_criteria_md`, `type TASK`, `status PENDING`, `priority MEDIUM`, `estimatedHours` when given, `metadata.quote = { customer_ops_quote_id, number, version, line_kind, position, weeks?, customer_ops_line_id?, option_group? }`. `option`, `recurring`, `hourly`, `included`, `excluded` lines never become tasks (A16). No due dates are invented from `weeks`. |
| **Document** | the PDF, stored in the document bucket under `quotes/<workspace>/<quote id>/v<version>/<file_name>` (deterministic → a retry overwrites, never duplicates), `mimeType application/pdf`, `status UPLOADED`, `tags ["quote"]`, `description "Accepted quote <number> v<version>"`, `metadata.quote` ids. Bytes must start with `%PDF-` (`422 PDF_INVALID`), ≤ 25 MB. |
| **Audit** | one `CREATE Project` audit row with the quote ids and `source: customer-ops` |
| **Events** | `project.created` + one `task.created` per task, after commit — automations and webhooks fire exactly as for an interactive create |

Attribution: `createdById` / `uploadedById` are hard FKs to `users`, and the
federation principal has no row, so the adapter writes as one deterministic,
**non-login** service user — `username federation:customer-ops`,
`email customer-ops@federation.invalid` (RFC 2606 reserved TLD), no password,
no Keycloak link, `weeklyCapacityHours 0` — upserted atomically on first use.
It shows up in the users list as "Customer-Ops Federation"; it cannot sign in,
mint a PAT, or be matched by SSO.

Everything DB-side happens in **one workspace RLS transaction** under a
Postgres advisory lock keyed by `(workspace, quote id, version)`, so two
concurrent accepts of the same quote serialise and the second one replays.
Object-store I/O runs outside the transaction (repo discipline), before it.

### Idempotency and merge semantics

Key: `customer_ops_quote_id + version` (+ the workspace, ANDed explicitly so
the key can never match across workspaces even while RLS is inert).

| Replay carries… | Effect |
|---|---|
| the same payload | nothing written; `200` with the **same** `project_id`, `task_ids[]` (position order), `document_id` |
| new `schedule_ids` | union merged into `metadata.quote.schedule_ids` (existing order kept, dupes dropped); other metadata untouched; no write when unchanged |
| a `pdf` the first call lacked | stored once and attached; a later replay does not re-upload |
| a **different `version`** | a **distinct** federation (new project) — the contract keys by id + version |

### Response

`201` on create, `200` on replay — both `status: "done"` (A7). Every non-2xx is
one envelope: `{ "status": "failed", "code", "reason", "http_status" }`, so
Customer-Ops can record `federated.project_ops = failed` with a reason and
re-run only the failed adapter.

```json
{
  "status": "done",
  "created": true,
  "project_id": "5a1d…",
  "project_number": "PROJ-2026-000042",
  "task_ids": ["…", "…", "…"],
  "document_id": "…",
  "contact_linked": true,
  "schedule_ids": ["…"],
  "quote": { "customer_ops_quote_id": "…", "number": "Q-2026-0001", "version": 1 }
}
```

| `code` | HTTP | Meaning |
|---|---|---|
| `VALIDATION` | 400 | payload shape (message lists the offending properties) |
| `UNSUPPORTED_CURRENCY` | 400 | not a 2-decimal ISO 4217 currency (A17) |
| `VERSION_MISMATCH` | 400 | `billing.version_no ≠ version` |
| `PDF_INVALID` | 400 / 422 | bad base64 / bytes are not a PDF |
| `PDF_TOO_LARGE` | 413 | > 25 MB |
| `PDF_FETCH_FAILED` | 502 | `pdf.url` unreachable / non-2xx / empty / a redirect (never followed) |
| `PDF_URL_NOT_ALLOWED` | 400 | `pdf.url` is not on an allow-listed origin, or no origin is configured |
| `PDF_STORE_FAILED` | 503 | object store refused the upload |
| `FEDERATION_ACTOR_REQUIRED` | 403 | not the `customer-ops` actor, or no vouched workspace |
| `FEDERATION_WORKSPACE_UNKNOWN` | 404 | the vouched `workspace_id` does not exist here (create path only) |
| `FEDERATION_WORKSPACE_INACTIVE` | 409 | the vouched workspace is suspended / archived (create path only) |
| `UNAUTHENTICATED` | 401 | no / invalid token |
| `INTERNAL` | 500 | unexpected; nothing partial is left behind (single transaction) — retry federation |

A failure never leaves a half-federated project: the PDF is resolved and
stored **before** the transaction, and the transaction is all-or-nothing.

### curl example (placeholders only — no secret values)

```bash
# A Brigade token exchange minted FOR project-ops with act.client_id=customer-ops
# and a workspace_id claim. Never paste a real token into a chat or a commit.
PROJECT_OPS_URL="https://projects.example.dev"          # placeholder
FEDERATION_TOKEN="$PROJECT_OPS_FEDERATION_TOKEN"        # from the env, never inline

curl -sS -X POST "$PROJECT_OPS_URL/api/v1/federation/quotes/accepted" \
  -H "Authorization: Bearer $FEDERATION_TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "customer_ops_quote_id": "<customer-ops quote uuid>",
  "number": "Q-2026-0001",
  "version": 1,
  "title": "Order Pad for the apparel client",
  "share_url": "https://customers.example.dev/q/<share-token>",
  "client_name": "The apparel client",
  "contact_id": "<project-ops contact uuid, optional>",
  "currency": "USD",
  "billing": {
    "one_time_total_cents": 140000,
    "milestone_total_cents": 290000,
    "deposit_cents": 215000,
    "recurring": [
      { "interval": "month", "amount_cents": 35000, "label": "Managed hosting" },
      { "interval": "year",  "amount_cents": 12000, "label": "AI allowance" }
    ],
    "hourly_rate_cents": 15000,
    "schedule_text": "50% on acceptance, 50% on acceptance of each milestone; hosting billed monthly in advance.",
    "version_no": 1
  },
  "lines": [
    { "kind": "one_time",  "label": "Discovery + setup",                    "acceptance_criteria_md": "…", "estimated_hours": 8,  "position": 1 },
    { "kind": "milestone", "label": "Milestone 1 — pilot on the floor",     "acceptance_criteria_md": "…", "estimated_hours": 16, "weeks": 2, "position": 2 },
    { "kind": "milestone", "label": "Milestone 2 — order pad in production", "acceptance_criteria_md": "…", "estimated_hours": 24, "weeks": 3, "position": 3 },
    { "kind": "option",    "label": "Package: Pro",     "option_group": "package", "selected": false, "position": 4 },
    { "kind": "option",    "label": "Package: Starter", "option_group": "package", "selected": true,  "position": 4 },
    { "kind": "recurring", "label": "Hosting", "position": 5 }
  ],
  "pdf": { "url": "https://customers.example.dev/api/quotes/<id>/versions/1/pdf?sig=<signed>", "file_name": "Q-2026-0001-v1.pdf" },
  "schedule_ids": [],
  "accepted_at": "2026-09-12T18:04:00Z"
}
JSON
```

Replaying the exact command returns `200` with the same ids. Sending it
again with `"schedule_ids": ["<accounting-ops schedule id>"]` merges the id
into `metadata.quote.schedule_ids`.

---

## 2. The Quote panel (read-through)

### Routes

| Route | Who | Returns |
|---|---|---|
| `GET /api/v1/projects/:id/quote` | any member of the workspace (same guards as `GET /projects/:id`) | the **staff** panel; a CLIENT hitting it gets the masked view |
| `GET /api/v1/client-portal/projects/:id/quote` | `CLIENT` role, own projects only (contact ↔ project ownership asserted in the RLS tx, 403 otherwise) | the **client** panel |

Response (`linked: false` when the project did not come from a quote — the UI hides the panel):

```json
{
  "linked": true,
  "source": "customer-ops",          // or "cached"
  "configured": true,                // staff only
  "degraded": null,                  // or { "reason": "UNCONFIGURED|UNREACHABLE|DENIED|NOT_FOUND|ERROR", "message": "…" }
  "tax_note": "Amounts exclude tax; tax is applied on the invoice.",
  "schedule_ids": ["…"],             // staff only
  "quote": { "number", "version", "title", "status", "totals": { "currency", "one_time_total_cents", "milestone_total_cents", "recurring_monthly_cents", "one_time_plus_milestones_cents", … }, "share_url", … }
}
```

**CLIENT mask (contract §5, task brief):** the client panel's `quote` is built
by explicit construction — `number`, `version`, `title`, `status`,
`totals { currency, one_time_total_cents, milestone_total_cents,
recurring_monthly_cents, one_time_plus_milestones_cents }`, `share_url` —
and nothing else, whatever Customer-Ops returns (hourly rate, deposit,
year-one, acceptance details, federation cursors, and anything internal are
dropped by construction). The degraded message shown to a client is generic
and never names an environment variable. `tax_note` (A9) is rendered next to
the totals on both panels.

### Degrade-clean

`CUSTOMER_OPS_BASE_URL` / `CUSTOMER_OPS_SERVICE_TOKEN` unset → no network
call, `source: "cached"`, `degraded.reason: "UNCONFIGURED"`, and the staff
message says *connect Customer-Ops* (naming the two variables). Unreachable /
denied / 404 / 5xx → the same cached view with the reason. The cached view is
`metadata.quote` + `metadata.quoteSummary`, i.e. the accepted numbers.

### What Customer-Ops serves (L1)

`GET {CUSTOMER_OPS_BASE_URL}/api/quotes/{customer_ops_quote_id}/summary?project_ops_project_id={project id}`
with `Authorization: Bearer <CUSTOMER_OPS_SERVICE_TOKEN>` (suite service-bearer
pattern, same as `ACCOUNTING_OPS_SERVICE_TOKEN`), plus hints
`X-Workspace-Id: <project-ops workspace id>` and
`X-Project-Ops-Project-Id: <project id>`. Per A15 Customer-Ops authorises by
the actor's workspace membership **and** `federated.project_ops_project_id ==
project_ops_project_id`; Project-Ops never fetches by a bare quote id (the
client refuses to call without a project id).

The reader is tolerant: the summary may be top-level or under `quote`, totals
nested under `totals` or flat, snake_case; it reads `id|customer_ops_quote_id`,
`number`, `version|current_version_no|version_no`, `title`, `status`,
`currency`, `one_time_total_cents|one_time_cents`,
`milestone_total_cents|milestone_cents`, optional
`year_one_illustration_cents|year_one_cents`, `deposit_cents`,
`tax_estimate_cents`, `hourly_rate_cents` (or `hourly_primary.rate_cents`),
`share_url`, `valid_until`, `accepted_at`, `sent_at`, `pdf_url`, `federated`.
The recurring figure is read from `recurring_monthly_cents`, from
`computeQuote`'s `recurring { month_cents, quarter_cents, year_cents,
monthly_equivalent_cents }` object, or from a `recurring[]` array — blended
with the same `month + quarter/3 + year/12` formula — so the panel does not
break on whichever projection L1 chooses to serve. Unknown keys are ignored. (Full request/response proposal:
`docs/quotes/proposals/L4-federation-wire-contract.md`.)

---

## 3. MCP

`get_project` now returns `quote` (mirroring `metadata.quote`) and keeps
`metadata.quote` in the row. For a `CLIENT` caller both are masked to
`{ number, version, share_url }` — the Customer-Ops id and the Accounting-Ops
schedule ids are internal wiring. `metadata.quoteSummary` needs no masking: it
only ever holds title / currency / status / totals.

---

## 4. Frontend

`frontend/components/project/quote-panel.tsx` (`<QuotePanel endpoint variant />`)
renders number + version, status pill, title, four money tiles (one-time,
milestones, monthly recurring, committed), the tax note, an **Open quote**
link (the share URL), and a source line (live / cached + reason). Mounted
above **Billing & Invoicing** on `app/dashboard/projects/[id]/page.tsx`
(`variant="staff"`) and above **Billing** on
`app/client-portal/projects/[id]/page.tsx` (`variant="portal"`). It self-hides
when the endpoint says `linked: false` or fails.

---

## 5. Configuration

| Variable | Side | Notes |
|---|---|---|
| `PROJECT_OPS_FEDERATION_ACTORS` | inbound | CSV allow-list; must include `customer-ops`. Default empty = zero federation trust. |
| `BRIGADE_TRUSTED_ISSUERS`, `BRIGADE_EXPECTED_AUDIENCE` | inbound | existing Brigade verification; audience must be `project-ops` |
| `CUSTOMER_OPS_BASE_URL` | read-through | e.g. `https://customers.magicunicorn.dev` |
| `CUSTOMER_OPS_SERVICE_TOKEN` | read-through | service bearer; value lives in the env / Vaultwarden only |
| `CUSTOMER_OPS_TIMEOUT_MS` | read-through | default 5000 |

No schema migration: everything lands in existing columns and `metadata`.

---

## 6. Tests

Unit (`npm test`, no DB):

- `src/quotes/quote-federation.util.spec.ts` — currency (A17), cents → decimal, billing notes wording, task-line selection/order (A16), schedule-id merge, object/lock keys, PDF magic.
- `src/quotes/quotes-federation.service.spec.ts` — first acceptance (every field), service-user attribution, unresolved contact, no hourly line, no PDF; idempotent replay (same ids, no writes, no events), distinct version, cross-workspace isolation of the key, schedule-id merge (only writes on change), replay attaches a missing PDF once; classified failures (currency, version mismatch, invalid PDF, fetch failure, store failure) create nothing.
- `src/quotes/quotes-federation.controller.spec.ts` — actor gating (human ADMIN / meeting-ops / no workspace → 403), 201 vs 200, header never consulted; `FederationStatusFilter` envelope.
- `src/common/workspace/federation-actor.guard.spec.ts` — route scope for `quoteAccepted`, allow-list still required, claim over header, `ingest` unchanged.
- `src/customer-ops/quote-summary.spec.ts` — the CLIENT whitelist against a "poisoned" summary; tolerant normaliser; cache readers.
- `src/customer-ops/http-customer-ops.client.spec.ts` — inert when unconfigured, request shape (project id, bearer, hints), status mapping, never throws.
- `src/customer-ops/quote-panel.service.spec.ts` — live vs cached, staff vs client, degraded wording.
- `src/client-portal/client-portal.service.spec.ts`, `src/mcp/mcp.tools.spec.ts` — portal ownership + MCP masking.

Integration (`tests/integration/rls/run.sh`) needs Docker for the throwaway
Postgres; it does not cover this seam (no new tables/policies).

---

## 7. Decisions and non-goals

- **Actor-only ingress.** No ADMIN replay path (see §1). Note that
  `@SkipWorkspaceMembership()` disables *every* instance of
  `WorkspaceMembershipGuard` on a route, including a per-route one — a human
  on such a route is never membership-checked. This seam avoids the question
  by refusing humans; `triage/ingest` (out of scope here) relies on the same
  decorator.
- **`kind: option` lines never become tasks** (their deliverables are the
  `one_time` / `milestone` lines of the selected package). Selected-ness is
  honoured on `one_time` / `milestone` lines that sit in an option group.
- **No due dates from `weeks`**: recorded on task metadata only; scheduling is
  a human call. Recurring lines are narrative in `billingNotes` (contract v1).
- **The vouched workspace must be real.** On the create path the adapter checks
  that the `workspace_id` in the claim exists and is `active`
  (`FEDERATION_WORKSPACE_UNKNOWN` / `FEDERATION_WORKSPACE_INACTIVE`), because
  `Project.workspaceId` carries **no FK to `workspaces`** — a typo'd claim would
  otherwise create a live row under an id RLS then hides from every human. A
  replay skips the check: it found rows in that workspace, so it demonstrably
  exists, and a workspace suspended after acceptance must still be able to
  return its own ids idempotently. **Follow-up:** the durable fix is a real FK
  on `Project.workspaceId` (+ `Task`, `Document`), which needs a migration; this
  PR ships no schema change.
- **A new `version` is a new project** (contract: keyed by id + version).
  Compensating actions on void / supersede are v1.1 (Amendment 01, deferred).
- **`pdf` optional, attached once on a later call** — so a render failure in
  Customer-Ops does not block the project, and "retry federation" completes it.
- **`pdf.url` is an origin-pinned server-side fetch.** It is still a fetch the
  server makes on a caller's say-so, so it is fenced rather than trusted:
  - the URL's **origin must be allow-listed** — `CUSTOMER_OPS_BASE_URL` counts
    automatically, `QUOTES_PDF_ALLOWED_ORIGINS` (CSV) adds others. With neither
    configured a `pdf.url` is **refused** (`400 PDF_URL_NOT_ALLOWED`) and only
    `pdf.base64` federates: **fail closed**, like `PROJECT_OPS_FEDERATION_ACTORS`
    defaulting to empty;
  - **redirects are never followed** (`redirect: 'manual'`; a 3xx is
    `PDF_FETCH_FAILED`), so a pinned origin cannot bounce the fetch inward;
  - the 25 MB cap is enforced **while streaming the body**, not after buffering
    it, so an absent or lying `content-length` cannot make the server hold an
    unbounded body in memory; the 15 s abort covers the body read, not just the
    headers.

  This matters because the actor rail is only as tight as Brigade's minting: a
  token exchange that carried `act.client_id=customer-ops` without a human
  identity claim would make this fetch a caller's, and an unpinned fetch would
  then reach anything the container can route to.
