# Connecting your coding agent to Project Ops MCP

Project Ops exposes an MCP (Model Context Protocol) server at
`https://api.projectops.magicunicorn.dev/api/v1/mcp` (Streamable HTTP transport).
Any MCP-capable client — Claude Code, OpenCode, Cursor, Continue, Zed, your own
custom agent — can read and write Project Ops on the calling user's behalf,
with the same RBAC as the dashboard.

This is exactly the surface the in-app **Project Ops Assistant** (Brigade)
uses. You're plugging in via the same door.

## What you get

All tools are RBAC-scoped per user:

| Tool | Purpose |
|---|---|
| `list_my_projects` | Visible projects, newest first; optional `status` filter |
| `get_project` | Full detail by `id` or `projectNumber` (incl. recent tasks + comments) |
| `list_my_tasks` | Tasks assigned to you, sorted by due date |
| `search_projects` | Free-text across title / description / number / client / org |
| `get_recent_activity` | Comments + task updates across visible projects |
| `list_project_documents` | File metadata for a project's documents |
| `create_project` | New project, auto-numbers P-XXXXX |
| `create_task` | Task on a project you can see |
| `update_project_status` | NEW / IN_PROGRESS / UNDER_REVIEW / COMPLETED / ARCHIVED / ON_HOLD |
| `update_task_status` | PENDING / IN_PROGRESS / WAITING_FOR_CLIENT / COMPLETED / CANCELLED |
| `add_task_comment` | Post a comment on a task |
| `list_task_comments` | List comments on a task (paginated) |
| `update_task_comment` | Edit a task comment (author or ADMIN) |
| `delete_task_comment` | Delete a task comment (author, ADMIN, or MANAGER) |
| `list_triage_proposals` | Read the workspace-scoped triage queue, including meeting source metadata |
| `rule_triage_proposals` | Approve or reject up to 200 proposals with per-item results |

CLIENT-role users can only call the read tools; write tools enforce ADMIN /
MANAGER / STAFF role.

For exact federated lookups, `list_my_projects` and `search_projects` accept the optional UUID filters `customerOpsCustomerId` and `contactOpsContactId`; supply both to require both matches. The filters remain inside the calling user's workspace and visibility scope, and `search_projects` combines them with its free-text query.

## Triage review API and agent first pass

The dashboard at `/dashboard/triage` and the authenticated REST API share the
same workspace-scoped service. Pending proposals can be listed with:

```http
GET /api/v1/triage/proposals?status=PENDING&limit=200&offset=0
```

Each proposal includes its routing fields and `sourceRef`; Meeting-Ops records
may provide `sourceRef.meetingDate` and `sourceRef.meetingTitle` for review.
`PENDING` is an alias for `PENDING_REVIEW`.

Bulk review is:

```http
POST /api/v1/triage/proposals/bulk
Content-Type: application/json

{
  "proposalIds": ["proposal-uuid-1", "proposal-uuid-2"],
  "action": "reject",
  "reasonPreset": "duplicate",
  "reason": "Already tracked in the delivery board.",
  "duplicateOfTaskId": "task-uuid"
}
```

`action` is `approve` or `reject`; approvals may set `targetProjectId` to
override the agent's project. Valid rejection presets are `stale`, `duplicate`,
`not_ours`, `handled_elsewhere`, `vague`, and `personal`. The response is an
array of `{ id, ok, taskId?, error? }` results, capped at 200 proposal ids;
one failed item does not abort the rest. Rejection metadata is stored on the
proposal and included in its rejection reason text.

The equivalent MCP tools are `list_triage_proposals` and
`rule_triage_proposals`. The latter accepts `decisions` with
`{ proposalId, action, targetProjectId?, reasonPreset?, reason?,
duplicateOfTaskId? }` and uses the same per-item service path. It requires the
`write:tasks` PAT scope; listing requires `read:tasks`.

## Authentication

Bearer JWT signed with the Project Ops `JWT_SECRET`. The tools run as the
user identified by `sub`, so:

- A coding agent connected on Aaron's behalf sees Aaron's projects.
- The same agent, with a JWT minted for a STAFF user, sees only that user's
  assigned + created projects.
- A JWT for a CLIENT-role user can read but not write.

You don't need to manage refresh tokens. Use a long-lived service-account
JWT for headless agents (mint via `jwtService.sign(...)` inside the
`project-ops-backend` container — see `backend/src/auth/auth.service.ts`),
or hand the dev a personal JWT minted for their own user record.

> **Don't hand-copy the `JWT_SECRET` literal** — the env value contains a
> trailing `\nO` that's easy to miss and produces a token that fails
> verification silently. Always read it via `process.env.JWT_SECRET` from
> inside the container.

### Mint a token for yourself (admin-only)

```bash
ssh muut@100.126.207.157 "docker exec project-ops-backend node -e \"
const jwt = require('jsonwebtoken');
const t = jwt.sign(
  {
    sub:      '7990db95-7f7c-45cb-8f43-293a76e60774',  // your User.id
    email:    'aaron@magicunicorn.tech',
    role:     'ADMIN',
    username: 'aaron',
  },
  process.env.JWT_SECRET,
  { expiresIn: '90d' },
);
console.log(t);
\""
```

That gives you a 90-day JWT. Save it as `PROJECTOPS_MCP_TOKEN` in your shell
profile.

## Wiring it up — Claude Code

`~/.claude/mcp_servers.json`:

```json
{
  "mcpServers": {
    "project-ops": {
      "url": "https://api.projectops.magicunicorn.dev/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${PROJECTOPS_MCP_TOKEN}"
      },
      "transport": "streamable-http"
    }
  }
}
```

Restart Claude Code, then use `/mcp` to confirm `project-ops` is connected
and the 11 tools are visible.

## Wiring it up — OpenCode

`~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "project-ops": {
      "type": "remote",
      "url": "https://api.projectops.magicunicorn.dev/api/v1/mcp",
      "headers": {
        "Authorization": "Bearer ${PROJECTOPS_MCP_TOKEN}"
      }
    }
  }
}
```

## Wiring it up — Cursor / Continue / Zed

All three follow the same pattern: an MCP server entry pointing at the
URL above with the `Authorization` header. The transport is **Streamable
HTTP** (not SSE-only — the server requires both `application/json` AND
`text/event-stream` in the Accept header; most MCP clients handle this).

## Quick test

```bash
curl -sS https://api.projectops.magicunicorn.dev/api/v1/mcp \
  -H "Authorization: Bearer $PROJECTOPS_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

You should see an SSE event with the 11 tool definitions.

## When to use what

- **Human-planned project, agent assists with execution**: connect your
  coding agent. Ask it to fetch context with `list_my_tasks` /
  `get_project`, write code, then `update_task_status` to mark tasks
  COMPLETED as it ships them.

- **Agent-planned project**: have the coding agent call `create_project`
  + `create_task` to seed the work breakdown, then update status as it
  goes.

- **Inline status reporting**: ask your agent to call `get_project` +
  `get_recent_activity`, then draft a Markdown status report. (For real
  PDF rendering, the in-app Project Ops Assistant has access to the
  `generate_pdf` tool; standalone coding agents don't, but they can hand
  the rendered Markdown back to you.)

## Security notes

- The MCP endpoint is rate-limited (10 req/60s for unauthenticated routes,
  exempt for the MCP path itself via `@SkipThrottle({ short: true, long: true })`).
- All write operations are logged via NestJS's standard logging
  (`MCP create_task: user=… project=…` etc.) and visible in
  `docker logs project-ops-backend`.
- Project-Ops audit log captures the underlying changes through Prisma
  hooks — same trail as the UI.
- Don't share JWTs across users. Mint one per developer.
