import { MCP_TOOL_SCOPE_MAP, PAT_AVAILABLE_SCOPES } from '../auth/pat/pat.constants';

/**
 * Every Wave 2 MCP tool MUST have a scope mapping, or PAT-auth'd calls fail
 * closed (the dispatcher refuses an unmapped tool). This guards against adding a
 * tool but forgetting the scope wiring — mirrors time-tools-scope.spec.ts.
 */
const WAVE2_TOOLS = [
  'get_portfolio_report',
  'get_profitability_report',
  'get_throughput_report',
  'get_team_capacity',
  'get_my_capacity',
  'list_automations',
  'create_automation',
  'set_automation_enabled',
  'delete_automation',
  'list_custom_fields',
  'list_project_approvals',
  'request_approval',
];

describe('Wave 2 MCP scope wiring', () => {
  it('declares the new Wave 2 scopes as available', () => {
    for (const scope of [
      'read:reports',
      'read:capacity',
      'read:automations',
      'write:automations',
      'read:approvals',
      'write:approvals',
    ]) {
      expect(PAT_AVAILABLE_SCOPES).toContain(scope);
    }
  });

  it.each(WAVE2_TOOLS)('maps %s to a valid available scope', (tool) => {
    const scope = MCP_TOOL_SCOPE_MAP[tool];
    expect(scope).toBeDefined();
    expect(PAT_AVAILABLE_SCOPES).toContain(scope);
  });

  it('routes reads to read:* and mutations to write:*', () => {
    // Reporting + capacity reads.
    expect(MCP_TOOL_SCOPE_MAP['get_portfolio_report']).toBe('read:reports');
    expect(MCP_TOOL_SCOPE_MAP['get_profitability_report']).toBe('read:reports');
    expect(MCP_TOOL_SCOPE_MAP['get_throughput_report']).toBe('read:reports');
    expect(MCP_TOOL_SCOPE_MAP['get_team_capacity']).toBe('read:capacity');
    expect(MCP_TOOL_SCOPE_MAP['get_my_capacity']).toBe('read:capacity');
    // Automations: list reads, the rest write.
    expect(MCP_TOOL_SCOPE_MAP['list_automations']).toBe('read:automations');
    expect(MCP_TOOL_SCOPE_MAP['create_automation']).toBe('write:automations');
    expect(MCP_TOOL_SCOPE_MAP['set_automation_enabled']).toBe('write:automations');
    expect(MCP_TOOL_SCOPE_MAP['delete_automation']).toBe('write:automations');
    // Custom-field definitions read rides read:projects (no dedicated scope).
    expect(MCP_TOOL_SCOPE_MAP['list_custom_fields']).toBe('read:projects');
    // Approvals: staff list reads, request writes.
    expect(MCP_TOOL_SCOPE_MAP['list_project_approvals']).toBe('read:approvals');
    expect(MCP_TOOL_SCOPE_MAP['request_approval']).toBe('write:approvals');
  });
});
