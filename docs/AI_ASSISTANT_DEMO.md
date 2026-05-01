# Live transcript: the assistant in action

This is a real session captured against
`projectops.magicunicorn.dev` on **2026-05-01** at the v1.6.x release.
Each turn is a `POST /api/v1/assistant/chat` from a signed-in user,
forwarded to the Brigade `project-ops-assistant` agent, which calls the
Project-Ops MCP server with a per-user JWT minted at request time and
relays the answer back. The text below is verbatim — no edits.

For the user-facing walkthrough see
[`AI_ASSISTANT.md`](AI_ASSISTANT.md). For the developer-facing
MCP wiring see [`MCP_FOR_CODING_AGENTS.md`](MCP_FOR_CODING_AGENTS.md).

## Setup

- **Caller:** Aaron, ADMIN — sees everything in his org.
- **Agent:** `project-ops-assistant` running on local Gemma 4 26B-a4b
  (midboy1, Tailscale `100.121.80.175:8087`), free local inference.
- **Tools available to the agent:** 14 Project-Ops MCP tools + 4
  Brigade builtins (knowledge memory, doc generation, delegation).
- **Per-turn round-trip:** typically 2–6s; the agent runs one or two
  tool calls before composing its reply.

---

## Turn 1 — list visible projects

> **Aaron:** What projects do I have right now?

> **Agent:**
> You have 2 projects currently in progress, Aaron:
>
> *   **P-00001**: Brigade ↔ Project-Ops MCP integration (High priority)
> *   **P-00002**: Build In Public — Tuesday show prep (Medium priority)

*Tool call:* `list_my_projects` → returns the 2 visible projects with
priority. Note the agent addresses Aaron by name — `speaker_name`
flows from the dashboard session through to the prompt.

---

## Turn 2 — drill into a project

> **Aaron:** Show me the details on P-00001 — what tasks are open on it?

> **Agent:**
> **P-00001: Brigade ↔ Project-Ops MCP integration**
> **Status:** IN\_PROGRESS | **Priority:** HIGH | **Client:** Magic Unicorn (internal)
>
> **Open Tasks:**
> *   **Per-user JWT propagation (v2)** (HIGH) — Due: 2026-05-03
> *   **Schedule daily verification run** (MEDIUM) — Due: 2026-05-01 [IN\_PROGRESS]
> *   **Nextcloud Office integration via MCP** (MEDIUM) — [PENDING]
> *   **Verify expanded MCP tool set** (MEDIUM) — [PENDING]

*Tool call:* `get_project { id: "P-00001" }` — resolves the project
number, returns full detail including tasks + recent comments.

---

## Turn 3 — search

> **Aaron:** Search for any project with 'Build In Public' in the title.

> **Agent:**
> I found one project: **P-00002: Build In Public — Tuesday show prep**
> (Status: IN\_PROGRESS).

*Tool call:* `search_projects { q: "Build In Public" }` — free-text
across title, description, project number, client name, organization.

---

## Turn 4 — create a task (write tool)

> **Aaron:** Add a task to P-00002 — title: 'Capture the live agent
> demo transcript', type RESEARCH, MEDIUM priority, assigned to me.

> **Agent:**
> Done. I've added the task "Capture the live agent demo transcript"
> to P-00002.

*Tool call:* `create_task` against P-00002. Confirmed in the
underlying database 1.4 seconds later:

```sql
SELECT id, title, type, status, "createdAt" FROM tasks
 WHERE title = 'Capture the live agent demo transcript';
-- 9a2990b0-1f1a-4dc8-b8df-533f47d1e21e | OTHER | PENDING | 2026-05-01 00:27:41
```

(One small drift here: the LLM wrote `OTHER` instead of `RESEARCH`
for the type. Re-asking with explicit field naming usually fixes it
— see "Tips" in `AI_ASSISTANT.md`. Still a real write that landed in
the system, attributable to Aaron in the audit log.)

---

## Turn 5 — recent activity

> **Aaron:** What's been happening on my projects in the last day?

> **Agent:**
> Here is the recent activity across your projects:
>
> **P-00001 (Brigade ↔ Project-Ops MCP integration)**
> *   **Comments:**
>     *   Shafen Khan: Fixed healthcheck by switching docker probe to `/api/v1/health/live` to stop terminus memory flapping.
>     *   You: Tools are live; routing via `project-ops-backend:3201` over the docker network to bypass Traefik drops.
> *   **Task Updates:**
>     *   "Schedule daily verification run" moved to **IN\_PROGRESS**.
>     *   Updates to: "Nextcloud Office integration via MCP", "Verify expanded MCP tool set", and "Per-user JWT propagation (v2)".
>
> **P-00002 (Build In Public — Tuesday show prep)**
> *   **Task Updates:**
>     *   "Capture the live agent demo transcript" updated.
>     *   "Pick topic for next Tuesday" updated.

*Tool call:* `get_recent_activity { since: "1d" }` — comments + task
updates across visible projects, attributing each to its author. Note
how the agent surfaces the task IT created in this session as part of
"recent activity".

---

## Turn 6 — draft something

> **Aaron:** Draft a status update for P-00001.

> **Agent:**
> ### Status Update: P-00001
> **Project:** Brigade ↔ Project-Ops MCP integration
> **Status:** IN\_PROGRESS
> **Priority:** HIGH
> **Date:** 2026-05-01
>
> **Summary**
> The integration is currently in progress. Core tools are live and
> routing has been stabilized by bypassing the public Traefik URL in
> favor of internal docker network routing
> (`project-ops-backend:3201`). This resolved previous issues with the
> unhealthy-container drop.
>
> **Recent Activity**
> * **Infrastructure:** Healthcheck fix implemented (commit `3873edb`).
>   Switched docker probe to `/api/v1/health/live` to stabilize
>   Terminus memory thresholds.
> * **Connectivity:** Tools successfully wired and live as of
>   2026-04-29.
>
> **Task Progress**
> * **In Progress:** Schedule daily verification run (Due: 2026-05-01)
> * **Pending:** Per-user JWT propagation (v2) (Due: 2026-05-03) —
>   **HIGH PRIORITY**, Nextcloud Office integration via MCP, Verify
>   expanded MCP tool set.
>
> **Next Steps**
> 1. Complete the daily verification run schedule.
> 2. Prioritize the v2 JWT propagation to ensure secure per-user access.

*Tool calls:* `get_project` + `get_recent_activity` — the agent fetches
context, then composes the report inline. For a real PDF memo it would
hand off to the `project-ops-report-writer` specialist via
`delegate_to_agent` and call `generate_pdf`.

---

## What's working end-to-end here

- **Per-user JWTs.** Each tool call is signed with a 5-minute JWT
  scoped to Aaron's `sub`. Switch the caller to a CLIENT-role user and
  the same prompts return only that user's organization's projects —
  enforced server-side by `buildVisibilityFilter`, covered by the
  specs in `backend/src/mcp/mcp.tools.spec.ts`.
- **Native tool calling on local Gemma 4.** No OpenRouter, no
  Anthropic, no per-call cost. The agent uses Qwen-style
  `<tool_call>` XML which Brigade parses + executes server-side.
- **Audit trail.** Every write the agent does (the task creation in
  Turn 4) routes through the same Prisma hooks the dashboard uses, so
  the activity feed shows it as Aaron's edit.

## Known limits seen in this session

- **Memory recall in this session was empty.** Asking the agent to
  remember a preference, then asking it to recall, returned "no
  record" — a regression vs. the verified-working state in March 2026.
  Tracked as a follow-up; users can still tell the agent their
  preferences inline and the agent will respect them within the
  current conversation. See the "Known limits" section in
  `AI_ASSISTANT.md`.
- **Tool argument drift (Turn 4).** Asked for `RESEARCH` type, got
  `OTHER`. Re-asking with the field name spelled out usually fixes it.

## Try it yourself

Sign in to [projectops.magicunicorn.dev](https://projectops.magicunicorn.dev),
click **Ask** in the top bar, and try the prompts above against your
own data. Or wire your own coding agent up via
[`MCP_FOR_CODING_AGENTS.md`](MCP_FOR_CODING_AGENTS.md) — same surface,
same RBAC, your JWT.
