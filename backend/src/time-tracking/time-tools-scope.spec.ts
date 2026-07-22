import { MCP_TOOL_SCOPE_MAP, PAT_AVAILABLE_SCOPES } from '../auth/pat/pat.constants';

// Every time-tracking MCP tool MUST have a scope mapping, or PAT-auth'd calls
// fail closed (refused). This guards against adding a tool but forgetting the
// scope wiring.
const TIME_TOOLS = [
  'start_timer',
  'stop_timer',
  'log_time',
  'update_time_entry',
  'delete_time_entry',
  'list_time_entries',
  'submit_timesheet',
  'approve_time',
  'get_utilization',
  'create_billable_draft',
  'sync_invoice_status',
];

describe('time-tracking MCP scope wiring', () => {
  it('declares read:time and write:time scopes', () => {
    expect(PAT_AVAILABLE_SCOPES).toContain('read:time');
    expect(PAT_AVAILABLE_SCOPES).toContain('write:time');
  });

  it.each(TIME_TOOLS)('maps %s to a valid available scope', (tool) => {
    const scope = MCP_TOOL_SCOPE_MAP[tool];
    expect(scope).toBeDefined();
    expect(PAT_AVAILABLE_SCOPES).toContain(scope);
  });

  it('routes read tools to read:time and timers/timesheets to write:time', () => {
    expect(MCP_TOOL_SCOPE_MAP['list_time_entries']).toBe('read:time');
    expect(MCP_TOOL_SCOPE_MAP['get_utilization']).toBe('read:time');
    expect(MCP_TOOL_SCOPE_MAP['start_timer']).toBe('write:time');
    expect(MCP_TOOL_SCOPE_MAP['update_time_entry']).toBe('write:time');
    expect(MCP_TOOL_SCOPE_MAP['delete_time_entry']).toBe('write:time');
    expect(MCP_TOOL_SCOPE_MAP['approve_time']).toBe('write:time');
    expect(MCP_TOOL_SCOPE_MAP['create_billable_draft']).toBe('write:billing');
  });
});
