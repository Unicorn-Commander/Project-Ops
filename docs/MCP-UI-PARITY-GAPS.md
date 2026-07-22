# MCP ↔ UI Parity Gaps — PROPOSED follow-up tasks

**Parent task:** P-00085 / `9657b03c-ebec-409f-8d1f-8a49f9db97dc`  
**Matrix:** [`MCP-UI-PARITY.md`](./MCP-UI-PARITY.md)  
**Author:** Grok (grok CLI, max effort)  
**Date:** 2026-07-22  

Rules for this file:

- Document **real** gaps only (UI/REST exists today; MCP does not, or is partial).
- Do **not** invent net-new product features.
- Each entry is copy-pasteable into Project Ops `create_task` (title + description).
- Prefer thin MCP wrappers that **delegate** to existing services (same RBAC + `runForUser` as REST).

---

## Fixed on this branch (do not re-file)

1. **`submit_candidate_action_items` workspace resolution** — now uses `WorkspaceContextService.resolveAuthorized` (`backend/src/mcp/mcp.tools.ts:1206`) instead of env `DEFAULT_WORKSPACE_ID`.
2. **MCP call latency / error metrics** — process-local counters + Prometheus text at `GET /api/v1/health/mcp-metrics` and `…/prometheus` (`backend/src/mcp/mcp.metrics.ts`, gate in `mcp.service.ts`).

---

## G-01 — Task dependencies via MCP

```
Repo: Project-Ops
Title: [PROPOSED][LANE: frontier] MCP tools for task dependencies (list/add/remove)
Description:
UI/REST already supports task dependency graph:
  - GET  /tasks/:id/dependencies
  - POST /tasks/:id/dependencies
  - DELETE /tasks/:id/dependencies/:depId
Evidence:
  - backend/src/tasks/tasks.controller.ts:239-271
  - backend/src/tasks/tasks.service.ts (addDependency + cycle prevention)
MCP has create_task / update_task / update_task_status but NO dependency tools
(see docs/MCP-UI-PARITY.md §2). Agents cannot model ordering ("schema before UI").

Acceptance:
  - Add list_task_dependencies, add_task_dependency, remove_task_dependency MCP tools
  - Delegate to TasksService methods (same cycle/duplicate/self-link validation)
  - run via resolveAuthorized workspace; PAT scopes write:tasks / read:tasks
  - Unit tests for cycle rejection + visibility (same as REST)
  - Register tools in mcp.service.ts + MCP_TOOL_SCOPE_MAP + mcps.json if present
```

---

## G-02 — Subtasks / parentTaskId on MCP create_task

```
Repo: Project-Ops
Title: [PROPOSED][LANE: flash] MCP create_task accepts parentTaskId (subtasks)
Description:
Human UI creates subtasks with parentTaskId (task-details modal + TasksService.create).
MCP create_task (backend/src/mcp/mcp.tools.ts:1100-1172) omits parentTaskId even though
REST CreateTaskDto supports it (backend/src/tasks/dto/create-task.dto.ts).
list_my_tasks / get_project.tasks also do not expose parent/child linkage cleanly.

Acceptance:
  - Add optional parentTaskId to create_task inputSchema + implementation
  - Validate parent exists in same project + visible workspace (mirror TasksService)
  - Optionally add list_task_subtasks tool wrapping TasksService.getSubtasks
  - Tests for happy path + missing parent + cross-project parent rejection
```

---

## G-03 — get_task + list_project_tasks MCP reads

```
Repo: Project-Ops
Title: [PROPOSED][LANE: flash] MCP get_task and list_project_tasks
Description:
REST: GET /tasks/:id, GET /tasks/project/:projectId, GET /tasks (filters).
MCP only has list_my_tasks (assignee=self) and get_project embed (≤25 recent tasks).
Agents cannot fetch an arbitrary visible task by id or page a project's full backlog
without REST. See docs/MCP-UI-PARITY.md §2 PARTIAL/NONE rows.

Acceptance:
  - get_task({ taskId }) with buildVisibilityFilter + runScoped
  - list_project_tasks({ projectId|projectNumber, status?, limit? })
  - PAT scope read:tasks; RBAC same as TasksService.find*
  - Tests for STAFF visibility + CLIENT isolation
```

---

## G-04 — Delete task via MCP (soft policy)

```
Repo: Project-Ops
Title: [PROPOSED][LANE: frontier] MCP delete_task with same RBAC as REST
Description:
REST DELETE /tasks/:id exists (tasks.controller.ts:189). MCP has no delete_task.
Note: project hard-delete is INTENTIONALLY omitted from MCP (archive_project only);
task delete may still be desired for agent cleanup of mistaken creates, but should
reuse TasksService.remove and MANAGER/ADMIN gates if REST is stricter.

Acceptance:
  - Audit REST delete RBAC; mirror exactly in MCP
  - delete_task tool; write:tasks scope; runScoped visibility check first
  - Document intentional asymmetry vs archive_project in MCP-UI-PARITY.md
  - Tests for CLIENT deny + not-found
```

---

## G-05 — Comment list / update / delete parity

```
Repo: Project-Ops
Title: [PROPOSED][LANE: frontier] MCP comment list/update/delete parity
Description:
MCP only has add_task_comment (backend/src/mcp/mcp.tools.ts:520-571).
REST comments.controller.ts exposes POST/GET/PATCH/DELETE for comments.
Agents can post but cannot correct, remove, or page a task's full thread
(get_project only embeds project-level comments, not task threads).

Acceptance:
  - list_task_comments, update_task_comment, delete_task_comment
  - Delegate to CommentsService or TasksService comment methods
  - Preserve @mention event behavior on update if REST does
  - Workspace stamp + visibility via parent task/project
```

---

## G-06 — Document update / delete MCP tools

```
Repo: Project-Ops
Title: [PROPOSED][LANE: flash] MCP update_document + delete_document
Description:
MCP has list_project_documents, get_document_content, upload_document.
REST documents.controller.ts also has PATCH :id and DELETE :id
(documents.controller.ts:269-281). Agents cannot retire mistaken uploads or
fix metadata without REST.

Acceptance:
  - update_document (description/status fields REST allows)
  - delete_document (same MinIO + row cleanup as DocumentsService)
  - write:documents PAT scope; runScoped project visibility
  - Tests for orphan-doc admin rule parity with get_document_content
```

---

## G-07 — Contacts CRM via MCP

```
Repo: Project-Ops
Title: [PROPOSED][LANE: frontier] MCP contacts CRUD (parity with CRM UI)
Description:
UI/REST contacts.controller.ts: create/list/get/update/delete/invite + projects/billing.
MCP has organizations tools but zero contacts tools (docs/MCP-UI-PARITY.md §6).
Agents managing client orgs cannot attach contacts without REST.

Acceptance:
  - list_contacts, get_contact, create_contact, update_contact (delete optional)
  - invite_client if ContactsService.invite is safe for agent use
  - Workspace-scoped; same roles as REST
  - PAT scopes: propose read:organizations / write:organizations OR dedicated — document choice
```

---

## G-08 — Time entry delete + timesheet reject

```
Repo: Project-Ops
Title: [PROPOSED][LANE: flash] MCP delete_time_entry + reject_timesheet
Description:
Time MCP covers start/stop/log/update/list/submit/approve/utilization/billing.
Missing vs REST:
  - DELETE /time-entries/:id (time-entries.controller.ts:109)
  - POST timesheets/reject (timesheets.controller.ts:44)
Agents cannot undo a bad log or reject a submitted sheet via MCP.

Acceptance:
  - delete_time_entry + reject_timesheet tools
  - Delegate TimeEntryService / TimesheetService
  - workspaceFor(resolveAuthorized); write:time scope
  - Honor lock/bill immutability already in services
```

---

## G-09 — Capacity write (set weekly hours)

```
Repo: Project-Ops
Title: [PROPOSED][LANE: flash] MCP set_user_capacity
Description:
MCP has get_team_capacity + get_my_capacity. REST also PATCH capacity/users/:userId
(capacity.controller.ts:65-77, ADMIN/MANAGER). Planning agents cannot set capacity.

Acceptance:
  - set_user_capacity({ userId, weeklyCapacityHours })
  - Delegate CapacityService.setUserCapacity
  - assertManagerOrAdmin; resolveWorkspace; read:capacity is insufficient — use write scope
    (may require new PAT scope write:capacity OR reuse an existing write:* with doc note)
  - Tests for CLIENT/STAFF deny
```

---

## G-10 — Custom field definition update/delete

```
Repo: Project-Ops
Title: [PROPOSED][LANE: flash] MCP update/delete custom field definitions
Description:
MCP list_custom_fields + create_custom_field exist. REST also PATCH/DELETE
(custom-fields.controller.ts:63-76). Agents cannot retire or rename definitions
(key/entity immutability still enforced by service).

Acceptance:
  - update_custom_field, delete_custom_field tools
  - Delegate CustomFieldsService; write:projects scope (matches create_custom_field)
  - Tests for immutable key/entity rejection
```

---

## G-11 — Webhooks management (optional / lower priority)

```
Repo: Project-Ops
Title: [PROPOSED][LANE: backlog] MCP webhooks list/create/update/delete
Description:
Settings UI manages webhooks (webhooks.controller.ts). No MCP tools.
Lower priority than core task/project/time parity; useful for agent-driven integration setup.

Acceptance:
  - Thin wrappers over WebhooksService with same ADMIN gates
  - Never return raw signing secrets on list (mirror REST redaction)
  - Document PAT scope choice
```

---

## G-12 — Saved views + notifications (optional / lower priority)

```
Repo: Project-Ops
Title: [PROPOSED][LANE: backlog] Evaluate MCP for saved views + notifications
Description:
Human UI has saved views and notification inbox/prefs. No MCP tools today.
May be low value for coding agents (views are UI presentation; notifications are
human inbox). Evaluate whether list_notifications + mark_read is worth shipping
before implementing.

Acceptance:
  - Written decision in docs/ (ship vs skip) with use-case evidence
  - If ship: minimal list + mark_read only; no preference-spam from agents
```

---

## G-13 — Docs drift: MCP_FOR_CODING_AGENTS.md tool count

```
Repo: Project-Ops
Title: [PROPOSED][LANE: flash] Refresh MCP_FOR_CODING_AGENTS.md to 50-tool inventory
Description:
docs/MCP_FOR_CODING_AGENTS.md still documents "11 tools". Live server registers ~50
(backend/src/mcp/mcp.service.ts). Agents following the guide under-discover write
surfaces (time, wave2, members, documents upload, etc.).

Acceptance:
  - Update tool table to match MCP_TOOL_SCOPE_MAP / registerTool list
  - Link to docs/MCP-UI-PARITY.md for full matrix
  - Do not invent tools not in code
```

---

## Priority suggestion

| Priority | Gaps |
|----------|------|
| P0 (agent daily driver) | G-03 get_task / list_project_tasks, G-02 parentTaskId, G-01 dependencies |
| P1 | G-05 comments, G-06 documents, G-08 time reject/delete |
| P2 | G-07 contacts, G-09 capacity write, G-10 custom field defs, G-04 delete_task |
| P3 / docs | G-11 webhooks, G-12 views/notifs, G-13 guide refresh |

---

## create_task bulk seed (one-liner for agents)

After G-03 ships, an agent can seed these as tasks on P-00085; until then paste
each Description block via the existing `create_task` tool with
`projectNumber: "P-00085"` (or the live project number for this epic).
