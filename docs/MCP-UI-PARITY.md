# MCP ↔ Human UI Parity Matrix

**Task:** P-00085 / `9657b03c-ebec-409f-8d1f-8a49f9db97dc`  
**Branch:** `dev/grok/t9657b03c-mcp-ui-parity`  
**Author:** Grok (grok CLI, max effort)  
**Date:** 2026-07-22  
**Scope:** Audit of agent MCP surface vs human REST/UI capabilities for enterprise-grade parity. Gaps that need new work are filed in [`MCP-UI-PARITY-GAPS.md`](./MCP-UI-PARITY-GAPS.md).

## How to read this

| Column | Meaning |
|--------|---------|
| **UI / REST** | Human dashboard + REST controllers under `backend/src/**` |
| **MCP tool(s)** | Registered names in `backend/src/mcp/mcp.service.ts` |
| **Parity** | `FULL` · `PARTIAL` · `NONE` · `INTENTIONAL` |
| **RLS / tenancy evidence** | File:line for workspace scope on the **MCP write/read path** |

Workspace scope chokepoints (shared):

| Mechanism | Location | Role |
|-----------|----------|------|
| `runScoped` → `resolveAuthorized` + `runForUser` | `backend/src/mcp/mcp.tools.ts:213–225` | Direct-Prisma MCP tools (projects, tasks, comments, orgs, documents, billing fields) |
| `workspaceFor` → `resolveAuthorized` | `backend/src/mcp/mcp.tools.ts:237–244` | Time-tracking + billable rollup MCP tools (delegate to TT services) |
| `resolveWorkspace` → `resolveAuthorized` | `backend/src/mcp/mcp.tools.ts:1629–1632` | Wave 2 + member tools (delegate to domain services) |
| PAT bound-workspace gate | `backend/src/mcp/mcp.service.ts:165–174` | Fail-closed if PAT workspace ≠ resolved workspace |
| PAT scope map | `backend/src/auth/pat/pat.constants.ts:55–133` | Tool → scope for PAT-auth callers |
| RBAC `buildVisibilityFilter` | `backend/src/mcp/mcp.tools.ts:117–130` | Project visibility (ADMIN/MANAGER open; STAFF assignee/creator; CLIENT contact) |
| `assertCanWrite` | `backend/src/mcp/mcp.tools.ts:579–583` | CLIENT cannot mutate via MCP write tools |

Complementary product feed (not ops metrics): successful tool calls → `AgentEventsService.record` with `durationMs` (`backend/src/mcp/mcp.service.ts:206–226`).

Ops metrics (this branch): process-local counters + latency buckets + structured logs + Prometheus exposition:

- Recorder: `backend/src/mcp/mcp.metrics.ts`
- Wired in gate: `backend/src/mcp/mcp.service.ts:172–231`
- JSON: `GET /api/v1/health/mcp-metrics` (`backend/src/health/health.controller.ts`)
- Prometheus: `GET /api/v1/health/mcp-metrics/prometheus`

---

## 1. Projects

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| List projects (filters, search, stats) | `GET /projects`, stats routes — `projects.controller.ts:40–154` | `list_my_projects`, `search_projects` | PARTIAL | `runScoped` `mcp.tools.ts:352–369`, `452–457` |
| Get project detail | `GET /projects/:id` | `get_project` (id **or** projectNumber; embeds ≤25 tasks, ≤10 comments) | FULL | `runScoped` `mcp.tools.ts:383–419` |
| Create project | `POST /projects` | `create_project` | FULL | stamps `workspaceId` inside `runScoped` `mcp.tools.ts:836–850` |
| Update project fields | `PATCH /projects/:id` | `update_project` (+ customFields, recurrence) | FULL | `runScoped` + metadata validate `mcp.tools.ts:953–1000` |
| Update status | `PATCH /projects/:id/status` | `update_project_status` | FULL | `runScoped` `mcp.tools.ts:887–906` |
| Assign owner | `PATCH /projects/:id/assign` | via `update_project.assignedToId` | PARTIAL | same as update_project |
| Archive | status → ARCHIVED in UI | `archive_project` (wrapper → status ARCHIVED) | FULL | `mcp.tools.ts:1998–1999` → `updateProjectStatus` |
| Hard delete project | `DELETE /projects/:id` | — | INTENTIONAL | Agent surface deliberately archives only (`mcp.tools.ts:1988–1995`) |
| Budget endpoint | `GET /projects/:projectId/budget` | — | NONE | — |
| Project billing fields | UI project form / billing | `update_billing_fields` | FULL | `runScoped` `mcp.tools.ts:1570+` |

## 2. Tasks

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| List my tasks | `GET /tasks/my-tasks` | `list_my_tasks` | FULL | `runScoped` `mcp.tools.ts:427+` |
| List all / by project / overdue / by user | `GET /tasks`, `project/:id`, `overdue`, `user/:id` | partial via `get_project.tasks` (cap 25) | PARTIAL | get_project only |
| Get task by id | `GET /tasks/:id` | — (must use get_project embed or list_my_tasks) | NONE | — |
| Create task | `POST /tasks` (incl. `parentTaskId`) | `create_task` (**no** parentTaskId) | PARTIAL | `runScoped` + `workspaceId` stamp `mcp.tools.ts:1125–1168` |
| Update task | `PATCH /tasks/:id` | `update_task` | FULL | `runScoped` `mcp.tools.ts:1040–1094` |
| Update status | `PATCH /tasks/:id/status` | `update_task_status` | FULL | `runScoped` `mcp.tools.ts:1210–1228` |
| Assign | `PATCH /tasks/:id/assign` | via `update_task.assignedToId` | PARTIAL | same |
| Complete shortcut | `POST /tasks/:id/complete` | via `update_task_status` COMPLETED | PARTIAL | same |
| Delete task | `DELETE /tasks/:id` | — | NONE | — |
| Subtasks list/create | `GET /tasks/:id/subtasks` + create w/ parent | — | NONE | REST: `tasks.controller.ts:227–239` |
| Dependencies CRUD | `GET/POST/DELETE …/dependencies` | — | NONE | REST: `tasks.controller.ts:239–271` |
| Triage candidates (agent ingest) | triage UI + REST | `submit_candidate_action_items` | FULL | `resolveAuthorized` `mcp.tools.ts:1206–1207` → triage `runForUser` |
| Triage review queue + bulk decisions | triage UI + REST | `list_triage_proposals`, `rule_triage_proposals` | FULL | workspace-aware `TriageService.listProposals` / `applyDecisions` |

## 3. Comments

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| Add task comment (+ @mentions) | `POST /tasks/:id/comments` | `add_task_comment` (emits `task.comment.created`) | FULL | `runScoped` + `workspaceId` stamp `mcp.tools.ts:524–568` |
| List project comments | `GET /comments`, `project/:id` | partial via `get_project.comments` / `get_recent_activity` | PARTIAL | — |
| List task comments | `GET /tasks/:id/comments` | — | NONE | — |
| Update comment | `PATCH /comments/:id` | — | NONE | — |
| Delete comment | `DELETE /comments/:id` | — | NONE | — |

## 4. Documents

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| List project documents | `GET /documents/project/:projectId` | `list_project_documents` | FULL | `runScoped` `mcp.tools.ts:1240–1266` |
| View / download | download-url, view, download | `get_document_content` (text extract or presigned URL) | FULL | visibility via project filter `mcp.tools.ts:1295–1320` |
| Upload (presigned + multipart) | generate-upload-url, confirm, upload | `upload_document` (inline base64/text, 25MB cap) | PARTIAL | access check + create stamp `mcp.tools.ts:1453–1521` |
| Update metadata | `PATCH /documents/:id` | — | NONE | — |
| Delete document | `DELETE /documents/:id` | — | NONE | — |

## 5. Time tracking & billing

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| Start / stop timer | `POST timer/start`, `stop` | `start_timer`, `stop_timer` | FULL | `workspaceFor` `mcp.tools.ts:246–261` |
| Running timer | `GET timer/running` | — | NONE | — |
| Log time / list / update | `POST/GET/PATCH /time-entries` | `log_time`, `list_time_entries`, `update_time_entry` | FULL | `workspaceFor` `mcp.tools.ts:264–291` |
| Delete time entry | `DELETE /time-entries/:id` | — | NONE | — |
| Submit timesheet | `POST timesheets/submit` | `submit_timesheet` | FULL | `workspaceFor` `mcp.tools.ts:294–298` |
| Approve time | `POST timesheets/approve` | `approve_time` | FULL | `workspaceFor` `mcp.tools.ts:301–305` |
| Reject timesheet | `POST timesheets/reject` | — | NONE | — |
| Utilization report | `GET reports/utilization` | `get_utilization` | FULL | `workspaceFor` `mcp.tools.ts:308–310` |
| Realization / WIP / CSV export | reports controller | — | NONE | — |
| Billable draft / issue invoice / sync | billing controller | `create_billable_draft`, `issue_invoice`, `sync_invoice_status` | FULL | `workspaceFor` `mcp.tools.ts:312–343`, `1973–1984` |
| Billing rates CRUD | billing-rates controller | — | NONE | — |

## 6. Organizations & contacts (CRM)

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| List / get / create / update orgs | organizations controller | `list_organizations`, `get_organization`, `create_organization`, `update_organization` | FULL | `runScoped` `mcp.tools.ts:593–780` |
| Contacts CRUD + invite client | contacts controller | — | NONE | — |

## 7. Dependencies & schedule (UI-heavy)

| UI capability | REST / UI | MCP | Parity | Notes |
|---------------|-----------|-----|--------|-------|
| Task dependencies | tasks dependencies API | — | NONE | See gaps |
| Subtasks | parentTaskId | — | NONE | See gaps |
| Kanban board | frontend only (status PATCH) | status tools only | PARTIAL | Agent can change status, not drag UX |
| Master schedule / Gantt | schedule UI + project due dates | `update_project` dueDate | PARTIAL | No Gantt-specific MCP |

## 8. Wave 2 surfaces

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| Portfolio / profitability / throughput | reporting controller | `get_portfolio_report`, `get_profitability_report`, `get_throughput_report` | FULL | `resolveWorkspace` `mcp.tools.ts:1691–1722` |
| Team / my capacity | capacity controller | `get_team_capacity`, `get_my_capacity` | FULL | `mcp.tools.ts:1728–1751` |
| Set user weekly capacity | `PATCH capacity/users/:userId` | — | NONE | REST: `capacity.controller.ts:65–77` |
| Automations list/create/toggle/delete | automations controller | `list_automations`, `create_automation`, `set_automation_enabled`, `delete_automation` | FULL | `mcp.tools.ts:1758–1828` |
| Custom field definitions list/create | custom-fields controller | `list_custom_fields`, `create_custom_field` | PARTIAL | `mcp.tools.ts:1840–1959` |
| Custom field definition update/delete | PATCH/DELETE custom-fields | — | NONE | — |
| Custom field **values** | on project/task forms | via `create_*` / `update_*` `customFields` | FULL | `resolveTaskMetadata` / `resolveProjectMetadata` `mcp.tools.ts:1647–1686` |
| Request / list project approvals | client-portal approvals | `request_approval`, `list_project_approvals` | FULL | `mcp.tools.ts:1864–1910` |
| Client-side decide approval | portal decide API | — | INTENTIONAL | Client-portal human surface |

## 9. Workspace membership

| UI capability | REST | MCP tool(s) | Parity | RLS / tenancy evidence |
|---------------|------|-------------|--------|------------------------|
| List / invite / role / remove members | workspaces controller | `list_members`, `invite_member`, `update_member_role`, `remove_member` | FULL | `resolveWorkspace` + WorkspacesService `mcp.tools.ts:2025–2086` (control-plane membership table; non-RLS by design) |

## 10. Other UI features with **no** MCP surface

| Area | UI / REST | MCP | Parity |
|------|-----------|-----|--------|
| Webhooks | settings/webhooks | — | NONE |
| Saved views | saved-views API | — | NONE |
| Notifications + prefs | notifications API | — | NONE |
| Users admin | users controller | — | NONE |
| Email config | email controller | — | NONE |
| Dashboard widgets | dashboard controller | — | NONE |
| Agent activity UI | agents controller | capture writes events; no list tool | PARTIAL (product UI only) |
| PATs | pat controller | auth for MCP, not managed via MCP | INTENTIONAL |
| AI Assistant chat | assistant controller | uses MCP tools under the hood | N/A |

## 11. MCP tool inventory (50 registrations)

Core reads: `list_my_projects`, `get_project`, `list_my_tasks`, `search_projects`, `get_recent_activity`  
Core writes: `add_task_comment`, `create_project`, `update_project`, `update_project_status`, `archive_project`, `create_task`, `update_task`, `update_task_status`, `submit_candidate_action_items`  
Orgs: `list_organizations`, `get_organization`, `create_organization`, `update_organization`  
Documents: `list_project_documents`, `get_document_content`, `upload_document`  
Billing fields: `update_billing_fields`  
Wave 2: `get_portfolio_report`, `get_profitability_report`, `get_throughput_report`, `get_team_capacity`, `get_my_capacity`, `list_automations`, `create_automation`, `set_automation_enabled`, `delete_automation`, `list_custom_fields`, `create_custom_field`, `list_project_approvals`, `request_approval`  
Members: `list_members`, `invite_member`, `update_member_role`, `remove_member`  
Time (gated by feature flag): `start_timer`, `stop_timer`, `log_time`, `update_time_entry`, `list_time_entries`, `submit_timesheet`, `approve_time`, `get_utilization`, `create_billable_draft`, `issue_invoice`, `sync_invoice_status`

Source: `backend/src/mcp/mcp.service.ts` (`registerTool` × 50).

## 12. RLS / tenancy audit summary

| Path class | Scope mechanism | Verdict |
|------------|-----------------|---------|
| Direct-Prisma project/task/comment/org/document/billing writes | `runScoped` → `resolveAuthorized` + GUC-pinned `tx` + explicit `workspaceId` on create | **OK** |
| Time-tracking + rollup | `workspaceFor` → `resolveAuthorized` → domain services | **OK** |
| Wave 2 + members | `resolveWorkspace` → `resolveAuthorized` → domain services | **OK** |
| PAT callers | Scope map + bound-workspace fail-closed in `McpService` gate | **OK** |
| `submit_candidate_action_items` | **Fixed this branch:** was `resolveWorkspaceId(user, DEFAULT_WORKSPACE_ID)`; now `requireWorkspace().resolveAuthorized(user)` at `mcp.tools.ts:1206` | **OK (was gap)** |

No remaining **small** cross-tenant write holes found on MCP paths. Larger missing capabilities are product gaps (see GAPS doc), not silent fail-open tenancy bugs.

## 13. Observability

| Signal | Before this branch | After |
|--------|--------------------|-------|
| Structured per-tool log | ad-hoc `MCP <tool>:` logs inside tools | Gate logs `MCP tool=<name> status=ok\|error durationMs=N` |
| Success agent activity | `AgentEventsService` (+ durationMs) | unchanged |
| Error / denied counters | missing | `recordMcpToolCall` in gate |
| Latency histogram | missing | fixed buckets in `mcp.metrics.ts` |
| Scrape endpoint | OTEL Prometheus exporter exists but was not wired into MCP specifically | `GET /health/mcp-metrics` + `/health/mcp-metrics/prometheus` |

## 14. Related docs

- [`MCP_FOR_CODING_AGENTS.md`](./MCP_FOR_CODING_AGENTS.md) — client wiring (tool count there is historical; live count is 50)
- [`FEATURES.md`](./FEATURES.md) — human product tour
- [`MCP-UI-PARITY-GAPS.md`](./MCP-UI-PARITY-GAPS.md) — PROPOSED follow-up tasks
