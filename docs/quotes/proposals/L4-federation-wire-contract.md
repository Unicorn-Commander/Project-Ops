# L4 proposal — the Project-Ops federation wire contract (additive)

Lane: L4 (Project-Ops execution seam). Status: proposed 2026-09-12, built as
described (nothing here contradicts QUOTES-CONTRACT-v1 or Amendment 01; it
pins the wire-level details those documents leave open so L1/L3/L5 can
target one shape). Owner of the canonical copy: Customer-Ops repo
`docs/quotes/proposals/`.

## P1 · `quote.accepted` → Project-Ops: response envelope (A7)

Every call answers one of:

```
2xx  { status: "done", created: bool, project_id, project_number, task_ids[], document_id|null,
       contact_linked: bool, schedule_ids[], quote: { customer_ops_quote_id, number, version } }
non-2xx { status: "failed", code, reason, http_status }
```

`201` on create, `200` on an idempotent replay. `code` is stable
(`VALIDATION`, `UNSUPPORTED_CURRENCY`, `VERSION_MISMATCH`, `PDF_INVALID`,
`PDF_TOO_LARGE`, `PDF_FETCH_FAILED`, `PDF_STORE_FAILED`,
`FEDERATION_ACTOR_REQUIRED`, `UNAUTHENTICATED`, `INTERNAL`). Customer-Ops
records `federated.project_ops = done|failed` + `reason` from this envelope and
stores `project_id` as `federated.project_ops_project_id` (needed for P4).

## P2 · Payload additions beyond §3 (all optional, all additive)

| Field | Why |
|---|---|
| `lines[].selected` (default `true`), `lines[].option_group`, `lines[].customer_ops_line_id` | A16: Customer-Ops may send the full accepted snapshot; Project-Ops creates tasks only for `one_time`/`milestone` lines with `selected !== false`. `kind: option` lines never become tasks. |
| `pdf` **optional** | a render failure must not block the project; a later replay attaches the PDF once |
| `schedule_ids[]` at the top level | A14: Accounting-Ops ids may arrive on a second call; merged idempotently (union, order kept) |
| `billing.version_no` | A14: must equal `version` or the call fails `VERSION_MISMATCH` |
| `accepted_at` | informational |
| `contact_id` semantics | a **Project-Ops** Contact id; linked only when it resolves in the target workspace, else `contact_linked: false` (no error, nothing stored) |

Unknown keys are rejected (`400 VALIDATION`) by the app-wide validation
policy — internal notes, split rule and direct costs can never ride along.

## P3 · Currency (A17)

Rejected as `UNSUPPORTED_CURRENCY`: BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF
UGX UYI VND VUV XAF XOF XPF (0-decimal), BHD IQD JOD KWD LYD OMR TND
(3-decimal), CLF UYW (4-decimal). Everything else is treated as 2-decimal.

## P4 · `GET /api/quotes/:id/summary` — request shape Project-Ops sends (A15)

```
GET {CUSTOMER_OPS_BASE_URL}/api/quotes/{customer_ops_quote_id}/summary?project_ops_project_id={project id}
Authorization: Bearer {CUSTOMER_OPS_SERVICE_TOKEN}
Accept: application/json
X-Workspace-Id: {project-ops workspace id}          # hint only
X-Project-Ops-Project-Id: {project id}              # same value as the query param
```

Customer-Ops must: authorise the bearer's workspace membership; require
`federated.project_ops_project_id == project_ops_project_id` (else 403/404);
never serve a summary for a bare quote id. Project-Ops refuses to call
without a project id.

### Response shape Project-Ops reads (tolerant, snake_case)

```json
{
  "quote": {
    "id": "…", "number": "Q-2026-0001", "version": 1,
    "title": "…", "status": "accepted", "currency": "USD",
    "totals": {
      "one_time_total_cents": 140000, "milestone_total_cents": 290000,
      "recurring_monthly_cents": 35000,
      "year_one_illustration_cents": 850000, "deposit_cents": 215000,
      "tax_estimate_cents": null, "hourly_rate_cents": 15000
    },
    "share_url": "https://…/q/<token>",
    "valid_until": "2026-10-12", "accepted_at": "2026-09-12T18:04:00Z", "sent_at": "…",
    "pdf_url": "…",
    "federated": { "status": "complete", "project_ops": "done", "accounting_ops": "done", "partner": "skipped", "project_ops_project_id": "…" }
  }
}
```

The top-level wrapper is optional (the reader accepts the summary at the
root), totals may be flat, unknown keys are ignored. **Never** include
`internal_notes_md`, `split_rule`, `quote_costs`, `accepted_by` — the summary
is served to sibling apps; Project-Ops masks for CLIENT anyway, but the
contract says these never leave Customer-Ops.

## P5 · Attribution: the federation service user

Project-Ops attributes federated writes to a deterministic non-login user
`federation:customer-ops` (`customer-ops@federation.invalid`). Proposed as the
suite-wide convention for any sibling-app write that needs a `users` FK:
`federation:<app>` / `<app>@federation.invalid`, no password, no SSO link,
capacity 0.

## P6 · What the CLIENT role sees (contract §5)

`number`, `version`, `title`, `status`, `totals { currency, one_time_total_cents,
milestone_total_cents, recurring_monthly_cents, one_time_plus_milestones_cents }`,
`share_url`, plus the A9 tax note. Over MCP `get_project`, `quote` and
`metadata.quote` are `{ number, version, share_url }`. Nothing else, on any
surface, by construction (whitelist), with tests that assert the whitelist
never widens silently.
