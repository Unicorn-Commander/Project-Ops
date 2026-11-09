# Internal approvals (ORG-17)

Internal approvals are separate from client/portal approvals. Every row has
`type: INTERNAL`. A staff workspace member (human or agent) records their own
decision; the authenticated caller supplies `approverId` implicitly. Supplying
identity fields in the request is rejected. The task-comment role and workspace
membership rules apply, including the existing tenancy feature flag and viewer
write restriction.

REST surface (under `/api/v1`):

- `POST /internal-approvals`: append a decision with the body below.
- `GET /internal-approvals`: audit history, newest append first. Optional filters:
  `projectId`, `entity`, `entityRef`, `versionHash`; `limit` defaults to 50 (max 100),
  `offset` defaults to 0.
- `GET /internal-approvals/latest`: requires `projectId`, `entity`, `entityRef`,
  `versionHash`; returns the latest row for that exact binding, or `null`.

```json
{
  "projectId": "10000000-0000-4000-8000-000000000001",
  "entity": "pr",
  "entityRef": "https://example.com/repo/pull/17",
  "versionHash": "0123456789abcdef0123456789abcdef01234567",
  "decision": "APPROVE",
  "reason": "Reviewed this exact revision."
}
```

Entities are `task`, `document`, or `pr`; decisions are `APPROVE`, `REJECT`, or
`DEFER`. Task/document references must be full IDs belonging to the selected
project and workspace. PR references are opaque (prefer a canonical PR URL); no
forge request is made. Hashes are opaque and case-sensitive: send the full git
SHA or content hash, consistently. Limits: reference 300 characters, hash 128,
reason 5000; empty/whitespace-only values are rejected.

MCP tools use the same inputs and service:
`record_internal_approval` (`write:approvals`), `list_internal_approvals` and
`get_latest_internal_approval` (`read:approvals`). The caller remains the
approver. MCP scope mappings live with the registrations in the MCP module.

Rows cannot be edited or deleted through the API. Append a new decision to
supersede an earlier one. The server-assigned `sequence` defines append order,
including timestamp ties; a different version, project, or entity binding does
not supersede the previous decision. All earlier decisions remain in history.

Migration: `20261109160000_internal_approvals`. Its schema SQL was generated
without connecting to a database using `prisma migrate diff` between the base
and updated schemas. Custom SQL adds workspace RLS, runtime-role grants, and an
update/delete rejection trigger. It has not been applied. Roll out through the
baselined migration process; `db push` alone does not install these protections.
Project/user foreign keys restrict deletion to preserve the approval audit trail.
