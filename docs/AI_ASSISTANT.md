# The Project Ops Assistant

Every dashboard page in Project Ops has an **Ask** pill in the top bar.
Click it, or hit the sparkle icon in the sidebar, and a sidebar agent
panel slides in from the right. That agent — the **Project Ops
Assistant** — has live read + write access to your projects, tasks,
organizations, contacts, documents, billing, and activity.

It's powered by [Unicorn Brigade](https://brigade.magicunicorn.dev),
talks to Project Ops through the same MCP server documented in
[`MCP_FOR_CODING_AGENTS.md`](MCP_FOR_CODING_AGENTS.md), and remembers
things you tell it across conversations (per user — your memory is
yours).

> **See it in action:** [`AI_ASSISTANT_DEMO.md`](AI_ASSISTANT_DEMO.md)
> is a verbatim transcript of the assistant doing real work against
> live production data — listing projects, drilling into details,
> creating a task, drafting a status update.

## What you can ask

### Read your work

- *"What projects do I have right now?"*
- *"Show me everything in P-00001."*
- *"What's still open on the Brigade integration?"*
- *"What did Shafen change today?"*
- *"Find any project with 'migration' in the title or description."*
- *"What documents are attached to P-00002?"*
- *"What's the billing status across my projects?"*

### Plan + create

- *"Create a project called 'Q3 client onboarding' for Acme Corp,
  HIGH priority, due 2026-06-30."*
- *"Break P-00003 into tasks: design review, schema migration, frontend
  pass, QA, ship. Assign all to me, MEDIUM priority."*
- *"Add a task to P-00001 — 'Wire Nextcloud Office to documents tab',
  RESEARCH type, MEDIUM."*

### Update status

- *"Mark task TASK-0042 as completed."*
- *"Move P-00001 to UNDER_REVIEW."*
- *"Add a comment to TASK-0017: 'blocked on legal sign-off, ETA Friday'."*

### Draft + summarize

- *"Draft a status update for P-00002 covering the last week."*
- *"Summarize all my IN_PROGRESS tasks as a stand-up note."*
- *"Write a project kickoff email for P-00003 to the client."*

### Use its memory

The assistant remembers facts you tell it across sessions, scoped to
**your user** so it can't bleed between teammates.

- *"Remember that I prefer status updates as PDF memos, not emails."*
- *"What format do I prefer for status updates?"*
- *"Note that the Acme rebrand is paused until July."*

## How RBAC works

Per-user identity propagates end-to-end. The dashboard sends your
session, Brigade mints a **short-lived (5-min) JWT for your user**, and
the MCP server runs every tool call through Prisma's
`buildVisibilityFilter` — exactly the same filter the dashboard list
queries use. So:

- An **ADMIN** sees everything.
- A **MANAGER / STAFF** sees what they own or are assigned to.
- A **CLIENT** sees only their own organization's projects + shared
  documents, and can only call the read tools — write tools refuse for
  this role.

You don't need to do anything to opt in. Sign in normally; the
assistant inherits your permissions.

## Tool reference (high level)

The assistant has **14 tools** across read + write surfaces. Full
schema lives in `docs/MCP_FOR_CODING_AGENTS.md`; this is the
human-readable summary.

**Read** — `list_my_projects`, `get_project`, `list_my_tasks`,
`search_projects`, `get_recent_activity`, `list_project_documents`,
`get_document_content`.

**Write** — `create_project`, `create_task`, `update_project_status`,
`update_task_status`, `update_billing_fields`, `add_task_comment`,
`upload_document`.

**Memory** — `knowledge_store`, `knowledge_query` (per-user, persistent
across conversations).

**Output** — `doc_generate`, `generate_pdf` (renders Markdown / a
templated report into a downloadable file).

**Delegation** — `delegate_to_agent` lets the assistant hand longer
work to a specialist sub-agent (e.g.,
`project-ops-report-writer` for full-length PDF reports).

## Tips for better results

- **Name what you mean.** *"P-00002"* beats *"the build-in-public
  project"* because it's an exact ID lookup. The assistant can resolve
  fuzzy names but exact is faster + cheaper.
- **One ask per turn.** *"Mark TASK-0042 done AND draft a status
  update"* works, but *"Mark TASK-0042 done"* → review → *"now draft a
  status update"* keeps you in control of intermediate state.
- **Tell it what you want as output.** *"…as a 3-bullet stand-up
  note"* / *"…as a 1-paragraph email"* / *"…as a markdown table"*. The
  default is conversational prose; named formats give you cleaner
  artifacts.
- **Use memory deliberately.** Tell it your preferences once
  (*"I want billing status reports as PDF, not email"*) instead of
  re-explaining each session. The next conversation will pick it up.

## What's underneath

- **Frontend trigger** — `/dashboard/*` top-bar Ask pill →
  `<AssistantPanel>` sidebar component.
- **Backend proxy** — `POST /api/v1/assistant/chat` forwards the
  conversation to Brigade with your stable user ID for memory scoping.
- **Brigade agent** — `project-ops-assistant` running on local Gemma 4
  26B-a4b on midboy1 (free local inference, ~3-5s per turn). Supports
  native tool calling, falls back to OpenRouter / Bedrock if needed.
- **MCP server** — mounted at
  `https://api.projectops.magicunicorn.dev/api/v1/mcp`,
  Streamable HTTP transport, JSON-RPC 2.0 with SSE-framed responses.
  Per-user JWT minted on each tool call.
- **Memory store** — FalkorDB graph backend, partitioned by
  `agent_id = user:{your-user-id}`.

## Privacy + audit

- The assistant only sees what your role lets you see — see RBAC above.
- Every write through the assistant goes through the same audit log
  Prisma writes for the dashboard, so the activity feed shows
  *"Aaron updated TASK-0017"* whether you used the UI or the agent.
- Conversations are logged on the Brigade side for debugging; ask the
  Brigade admin to retain or purge per your policy. (Tool call
  arguments are logged; tool call results are not, to avoid leaking
  document contents into agent logs.)
- Memory entries are scoped per user — your teammate cannot recall
  something you stored, and vice versa.

## Known limits

- The assistant currently can't generate or attach images. PDF output
  is text + tables only.
- The Gemma 4 26B-a4b backend is fast and free but occasionally
  gets a tool-call argument shape slightly wrong. If a write fails,
  re-ask with explicit field names.
- Document upload through the assistant requires the file already
  living somewhere the backend can fetch — for raw paste-uploads,
  use the Documents tab in the UI.
- For self-recall to work cleanly, ask the assistant about
  *preferences* or *facts about you* rather than your full name —
  the assistant stores facts under a generic "User" entity scoped to
  your account, so "what format do I prefer for status updates?" is
  more reliable than "what does the assistant know about Aaron?"

## Going further — wire your own coding agent in

The same MCP server the assistant uses is open to any MCP-capable
client (Claude Code, OpenCode, Cursor, Continue, Zed, your own).
See [`MCP_FOR_CODING_AGENTS.md`](MCP_FOR_CODING_AGENTS.md) for the
JWT minting + client wiring guide.
