# Email-Ops integration — Project-Ops mail through Email-Ops

House rule: **professional mail goes through Email-Ops** (Apache James + agent-inbox
approval), never Gmail and never a Project-Ops-local SMTP relay. This doc is the
contract for moving Project-Ops email onto that rail.

Project-Ops today sends email out of its own `src/email` module (nodemailer +
SMTP, templates, `EMAIL_ENCRYPTION_KEY` field encryption). This doc defines what
changes as Email-Ops is wired in, and what the runner ships vs. what is deferred.

Code: `backend/src/email-ops/` (the `EmailOpsPort` + `HttpEmailOpsClient`),
consumed by `backend/src/email/email.service.ts` and
`backend/src/notifications/notification-email.listener.ts`.

---

## 1. What routes through Email-Ops (and in which mode)

Email-Ops `compose_email` takes a `mode`:

| Mode | Meaning | Project-Ops uses it for |
|---|---|---|
| `send` | deliver immediately (no human hop) | **proven internal notifications** — task assigned, mentions, status changes, timesheet approvals for non-CLIENT workspace members |
| `draft` | stage into the **agent inbox** for a human to approve | **client-facing mail** — proposals, client status updates, invoice notes, anything a customer reads |

Routing rule:

- **Internal notifications** → `mode = send` only after the recipient's active
  workspace membership is resolved and the recipient's application role is
  proven non-`CLIENT`. Missing membership or a `CLIENT` recipient uses
  `mode = draft`, preserving the approval gate for unproven recipients. These
  are the per-event emails `NotificationEmailListener` produces today
  (`sendNotificationEmail`). When `EMAIL_OPS_BASE_URL` is set,
  `EmailService.sendNotificationEmail` composes them through Email-Ops instead
  of the local SMTP transporter.
  `EmailService.canSend()` gates the listener on *either* SMTP *or* Email-Ops, so
  a deployment routing exclusively through Email-Ops still delivers.
- **Client-facing mail** → `mode = draft`. The individual client-facing send
  methods (`sendProjectStatusUpdateEmail`, proposal/invoice mail, …) are mapped
  here to `compose_email(…, mode: 'draft')`; a draft lands in the agent inbox and
  only a human approval puts it on the wire. This half is specified below and is
  consumed incrementally as those send paths are migrated.

**Flag semantics (unchanged when off):** the client is inert when
`EMAIL_OPS_BASE_URL` (and `EMAIL_OPS_SERVICE_TOKEN`) are unset —
`isConfigured()` returns false and `EmailService.sendNotificationEmail` keeps its
today-SMTP behaviour. There is no behaviour change without the flag.

## 2. Idempotency key

Email-Ops de-dupes `compose_email` on the tuple
`(workspace_id, external_source, external_ref)` (a unique index on
`email_messages`). Project-Ops always sends:

- `workspace_id` — the Project-Ops workspace the task/project lives in;
- `external_source = 'project-ops'` — a fixed constant;
- `external_ref` — a stable, caller-chosen ref. Project-Ops uses
  `<eventName>:<entityId>:<recipientUserId>[:<instanceId>]` for notifications,
  where `<instanceId>` disambiguates distinct occurrences of the same event type
  on the same entity (a comment id, event id, or persisted `updatedAt`) so a
  second comment or status flip is a DIFFERENT key and still delivers — while
  a true retry of the same occurrence returns the SAME message and sends
  nothing twice.

The client (`HttpEmailOpsClient.compose`) POSTs these as the MCP `compose_email`
tool arguments over the suite M2M rail
(`POST {EMAIL_OPS_BASE_URL}/api/v1/mcp`, bearer `EMAIL_OPS_SERVICE_TOKEN`), the
same seam Customer-Ops uses. `compose_email(mode: 'send')` requires the
`agent-inbox:approve` scope on the Email-Ops side, so the Project-Ops service
token must be minted with that scope (or internal notifications land as drafts /
are denied).

## 3. Project / task ↔ thread linking

- The compose carries an optional `contact_id` (a **Contact-Ops** contact id) and
  an optional `in_reply_to_thread_id` (an existing Email-Ops thread id).
- **Once L1 lands** (the project↔contact linkage in Project-Ops), Project-Ops
  resolves the client's Contact-Ops id from the project and passes it as
  `contact_id`, so Email-Ops can thread every client email for that contact in one
  conversation and keep the project/task ↔ thread link for later lookups.
- Until then `contact_id` is simply omitted (the client already accepts
  `contactId?` and only forwards it when present). No migration is needed on the
  Project-Ops side for this.

## 4. Fence — no Project-Ops migration (spec for Astra to sequence)

This integration adds **no Prisma migration** in Project-Ops. The client is
stateless: it derives the idempotency key from the compose call and lets Email-Ops
own the message/thread state.

If Project-Ops later wants a local **thread link** (a `project.tasks`/`project`
→ `email_ops_thread_id` column) so it can look up an Email-Ops thread by project,
that column is owned by **L1** (the project↔contact linkage) and is sequenced by
Astra — it is *specified here, not created by this task*:

- a nullable `email_ops_thread_id` (text) on `projects` (or on a
  `project_contacts` linkage row, pending L1's exact shape).

Nothing in this task touches `.env`, Keycloak, secrets, DNS, ssh or deploys.

## 5. What the runner ships vs. what is blocked

**Ships (this task):**
- `backend/src/email-ops/` client (`EmailOpsPort`, `HttpEmailOpsClient`) behind the
  `EMAIL_OPS_BASE_URL` / `EMAIL_OPS_SERVICE_TOKEN` flag, with mocked-fetch tests.
- Wiring of **internal notifications** (`EmailService.sendNotificationEmail` →
  role-gated `compose_email(mode: 'send' | 'draft')`) with the idempotency key,
  plus listener tests.
- Email-Ops side accepts `external_source = 'project-ops'` (entitlement + trusted
  compose source) with tests.
- This doc.

**Blocked / follow-up (not the runner's):**
- Real `EMAIL_OPS_SERVICE_TOKEN` (a service bearer minted for Project-Ops with the
  `agent-inbox:approve` scope) and the `EMAIL_OPS_BASE_URL` value — set by
  Persephone/Aaron.
- Email-Ops `project-ops` entitlement claim in Lago (the `UC_ENTITLEMENT_MODE=open`
  bootstrap currently bypasses the dual-SKU check; flipping to `enforce` requires
  the claim to exist).
- Migrating the client-facing send methods to `mode = 'draft'` (incremental; each
  method is a small, isolated change).
- The L1 thread-link column (Astra sequences it).
