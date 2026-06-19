/**
 * Personal Access Token constants.
 *
 * - PAT_PREFIX is the on-the-wire identifier the auth pipeline checks first
 *   to short-circuit JWT parsing. Matches the public manifest claim in
 *   `frontend/public/.well-known/mcps.json` (auth.prefix).
 * - PAT_TOKEN_BYTES is the entropy budget for the random suffix. 32 bytes
 *   = 256 bits, base64url-encoded to 43 chars; well above what's needed
 *   for a bearer credential and matches GitHub's PAT entropy.
 * - PAT_BCRYPT_COST stays at 10 to match the existing password handling
 *   in AuthService — no point introducing a second cost factor.
 */
export const PAT_PREFIX = 'po_pat_';
export const PAT_TOKEN_BYTES = 32;
export const PAT_BCRYPT_COST = 10;

/**
 * Scopes that can be granted to a PAT, mirrored from
 * `frontend/public/.well-known/mcps.json`. Kept here as the single source
 * of truth so the controller can validate the incoming scope list and the
 * MCP dispatcher can gate tool calls.
 */
export const PAT_AVAILABLE_SCOPES = [
  'read:projects',
  'write:projects',
  'read:tasks',
  'write:tasks',
  'read:documents',
  'write:documents',
  'read:activity',
  'read:organizations',
  'write:organizations',
  'write:billing',
  'read:time',
  'write:time',
  // Wave 2 surfaces (reporting / capacity / automations / custom-fields /
  // approvals). Reads are gated by a read:* scope; mutations by write:*.
  'read:reports',
  'read:capacity',
  'read:automations',
  'write:automations',
  'read:approvals',
  'write:approvals',
] as const;

export type PatScope = (typeof PAT_AVAILABLE_SCOPES)[number];

/**
 * Maps MCP tool name -> required scope. Kept in lock-step with
 * mcps.json's `tools[].scopes_required` AND with the tools actually
 * registered in `mcp.service.ts`. Tools registered on the server but
 * not declared in the manifest still need a mapping here so PAT-auth'd
 * calls fail closed rather than open.
 */
export const MCP_TOOL_SCOPE_MAP: Record<string, PatScope> = {
  // read:projects
  list_my_projects: 'read:projects',
  get_project: 'read:projects',
  search_projects: 'read:projects',
  // write:projects
  create_project: 'write:projects',
  update_project: 'write:projects',
  update_project_status: 'write:projects',
  // write:billing
  update_billing_fields: 'write:billing',
  // read:tasks
  list_my_tasks: 'read:tasks',
  // write:tasks
  create_task: 'write:tasks',
  update_task: 'write:tasks',
  update_task_status: 'write:tasks',
  add_task_comment: 'write:tasks',
  submit_candidate_action_items: 'write:tasks',
  // read:documents
  list_project_documents: 'read:documents',
  get_document_content: 'read:documents',
  // write:documents
  upload_document: 'write:documents',
  // read:activity
  get_recent_activity: 'read:activity',
  // read:organizations
  list_organizations: 'read:organizations',
  get_organization: 'read:organizations',
  // write:organizations
  create_organization: 'write:organizations',
  update_organization: 'write:organizations',
  // time tracking — read:time
  list_time_entries: 'read:time',
  get_utilization: 'read:time',
  // time tracking — write:time
  start_timer: 'write:time',
  stop_timer: 'write:time',
  log_time: 'write:time',
  update_time_entry: 'write:time',
  submit_timesheet: 'write:time',
  approve_time: 'write:time',
  // billable rollup — write:billing
  create_billable_draft: 'write:billing',
  sync_invoice_status: 'write:billing',
  // Wave 2 — reporting (read:reports)
  get_portfolio_report: 'read:reports',
  get_profitability_report: 'read:reports',
  get_throughput_report: 'read:reports',
  // Wave 2 — capacity (read:capacity)
  get_team_capacity: 'read:capacity',
  get_my_capacity: 'read:capacity',
  // Wave 2 — automations (read:automations / write:automations)
  list_automations: 'read:automations',
  create_automation: 'write:automations',
  set_automation_enabled: 'write:automations',
  delete_automation: 'write:automations',
  // Wave 2 — custom-field DEFINITIONS read. Reuses read:projects (these
  // describe the shape of projects/tasks; no dedicated scope is minted for a
  // single definitions read). Setting custom-field VALUES rides the existing
  // write:tasks / write:projects scopes via create_task/update_task/etc.
  list_custom_fields: 'read:projects',
  // Wave 2 — approvals (read:approvals / write:approvals)
  list_project_approvals: 'read:approvals',
  request_approval: 'write:approvals',
};
