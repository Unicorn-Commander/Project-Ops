# Agent seats — Project-Ops identities and Stable room delivery

House rules make the four agent seats (Astra, Rook, Majik, Persephone) first-class
workers in Project-Ops: they hold tasks, get assigned, post hold notes, and change
statuses. But an agent working in Stable must not need to poll Project-Ops to learn
something changed — **Project-Ops pushes the event to the agent's Stable room**.

This doc is the contract for that push. It has three parts:

1. How each agent seat gets a **Project-Ops identity** (a `users` row + role).
2. How Project-Ops **pushes** `task.*` events to Stable as signed webhooks.
3. How Stable **maps** a Project-Ops assignee to a room and posts a message.

> **Blocker (not the runner's job):** actually *creating* the Project-Ops users
> for the agent seats is **Persephone / Aaron's** call, not a lane runner's.
> Runners may write code, tests and this doc, but must not provision users,
> roles, or workspace membership. See §1 "Who does what".

---

## 1. Agent-seat identities in Project-Ops

| Seat | Persona | Expected Project-Ops role | Stable identity |
|---|---|---|---|
| **Astra** | scheduling / front-office | `STAFF` (assignee, commenter) | existing Stable agent participant |
| **Rook** | show runner | `STAFF` (show-night tasks) | existing Stable agent participant |
| **Majik** | house DJ / Majiks | `STAFF` | existing Stable agent participant |
| **Persephone** | everything-not-the-show | `STAFF` / `MANAGER` | existing Stable agent participant |

Each seat needs a real `users` row in Project-Ops (email + role + workspace
membership in the dogfood workspace). That row's `id` is the **Project-Ops
assignee id** used throughout this contract. No code here can mint that row —
it is created by an admin (Persephone) through the normal user-invite/management
path. Until the row exists:

- the seat cannot be assigned tasks, and
- the seat has no `id` to put in Stable's room mapping (§3), so no push happens
  (the receiver is inert — see §4 "flag off = inert").

**Do not** reuse the human's identity for an agent seat and **do not** give an
agent seat an ADMIN/OWNER role. Each seat is its own principal so audit trails
(`task.comment.created` → `authorId`, `task.assigned` → `assignedToId`) stay
honest about *who* (which agent) did what.

---

## 2. Project-Ops → Stable push (signed webhooks)

Project-Ops already emits signed outbound webhooks through `backend/src/webhooks/`
(`webhook-delivery.service.ts`, `webhooks.listener.ts`, `webhook-signing.ts`).
No new outbound machinery is needed; this doc pins the *subset* the Stable
receiver consumes.

### Events

| Event name | Emitted when | Payload `data` carries |
|---|---|---|
| `task.assigned` | a task is created assigned, or its assignee changes | `assignedToId`, `taskId`, `workspaceId`, `actorId`, `task` |
| `task.comment.created` | a comment is added to a task (the "task commented" event) | `assignedToId`, `title`, `taskId`, `commentId`, `authorId`, `content` |
| `task.status_changed` | a task's status changes | `assignedToId`, `fromStatus`, `toStatus`, `taskId`, `workspaceId`, `task` |

`assignedToId` is the **Project-Ops user id of the task's assignee** and is the
mapping key Stable uses. It is present at the top level of all three events so
the receiver never has to dig into the nested `task` object.

### Wire contract (the receiver must implement this)

Envelope POSTed to the subscribed URL:

```json
{
  "event": "task.assigned",
  "workspaceId": "<uuid>",
  "data": { "assignedToId": "<uuid>", "taskId": "<uuid>", "...": "..." },
  "timestamp": "2026-09-15T12:34:56.789Z"
}
```

Headers:

| Header | Value | Purpose |
|---|---|---|
| `X-ProjectOps-Signature` | `sha256=<hex>` | HMAC-SHA256 of the **raw body bytes** under the endpoint secret |
| `X-ProjectOps-Event` | the event name | route without parsing the body |
| `X-ProjectOps-Delivery` | a delivery id | dedupe retries |

**Signature:** `HMAC_SHA256(secret, raw_body)` → hex, prefixed `sha256=`. The
secret is the per-endpoint signing secret generated when the workspace
subscribes the endpoint (`POST /api/v1/webhooks`, shown once as `whsec_…`).
The signature is over the exact bytes POSTed (sign-what-you-send).

**Timestamp window:** the receiver must reject envelopes whose `timestamp` is
older than the configured window (default 5 minutes) or more than a small
skew into the future — this replays-proofs the push.

**Retries:** Project-Ops retries transient failures (network error, non-2xx)
with exponential backoff, up to 3 attempts, and records the outcome in
`webhook_deliveries`. A receiver must be idempotent; use the
`X-ProjectOps-Delivery` id (or the envelope) to dedupe.

### Wiring a workspace

A workspace admin points a webhook endpoint at the Stable receiver
(`https://stable.magicunicorn.dev/api/v1/webhooks/project-ops`), subscribing to
`task.assigned`, `task.comment.created`, `task.status_changed`. The endpoint
secret shown once at create-time becomes `PROJECTOPS_WEBHOOK_SECRET` in Stable
(§3). If no endpoint is subscribed, nothing is pushed — outbound delivery is
endpoint-subscription gated.

---

## 3. Stable receiver — assignee → room mapping

Stable exposes `POST /api/v1/webhooks/project-ops`. It:

1. returns `503` when `PROJECTOPS_WEBHOOK_SECRET` is unset (**flag off = inert**);
2. verifies the HMAC signature over the raw body;
3. rejects a stale/future `timestamp` (window check);
4. reads `data.assignedToId` (Project-Ops user id) and looks it up in the mapping;
5. posts a short message with a task link into the mapped room.

Mapping config (`PROJECTOPS_ROOM_MAPPING`) is a JSON object keyed by
**Project-Ops user id** → Stable room name:

```json
{ "<astra-project-ops-user-id>": "astra", "<rook-project-ops-user-id>": "show-deck" }
```

If the assignee id is absent from the mapping, the event is acknowledged and
dropped (logged) — an unmapped assignee never fails the webhook. The task link is
built from Stable's `PROJECTOPS_DASHBOARD_URL` + `data.projectId` (falling back
to `?task=<data.taskId>`). The receiver also de-duplicates on the
`X-ProjectOps-Delivery` header so Project-Ops' retries never double-post.
Until the agent-seat users from §1 exist and appear in this mapping, the
receiver is inert by construction.

---

## 4. What the runner ships vs. what is blocked

**Runner ships:** the code on both sides, tests, this doc. Specifically:
- Project-Ops: the three `task.*` events already carry a top-level
  `assignedToId` (the comment event was enriched to include `assignedToId` +
  `title`), and are delivered as signed, retried webhooks by the existing module.
- Stable: the signed receiver route, timestamp-window check, assignee→room
  mapping, and a short message post.

**Blocked for Persephone / Aaron (never the runner):**
- creating the four agent-seat `users` rows (identity, role, workspace membership);
- assigning the real signing secret (`PROJECTOPS_WEBHOOK_SECRET`) and the real
  `PROJECTOPS_ROOM_MAPPING` values (and confirming `PROJECTOPS_DASHBOARD_URL`
  points at the live dashboard);
- subscribing the workspace's webhook endpoint in the Project-Ops settings UI.

Until those three are done, the integration is deployed-but-inert (flag off).
