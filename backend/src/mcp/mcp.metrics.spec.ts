import {
  getMcpMetricsSnapshot,
  recordMcpToolCall,
  renderPrometheus,
  resetMcpMetricsForTests,
} from './mcp.metrics';

describe('mcp.metrics', () => {
  beforeEach(() => resetMcpMetricsForTests());

  it('records ok / error / denied per tool and aggregates totals', () => {
    recordMcpToolCall('list_my_projects', 'ok', 12);
    recordMcpToolCall('list_my_projects', 'ok', 8);
    recordMcpToolCall('create_task', 'error', 40);
    recordMcpToolCall('create_task', 'denied', 0);

    const snap = getMcpMetricsSnapshot();
    expect(snap.totals).toEqual({ ok: 2, error: 1, denied: 1, calls: 4 });

    const list = snap.tools.find((t) => t.tool === 'list_my_projects');
    expect(list).toMatchObject({
      ok: 2,
      error: 0,
      denied: 0,
      durationMsSum: 20,
      durationMsCount: 2,
    });
    // 12 and 8 both land in the ≤25ms bucket (and every larger one).
    expect(list!.buckets['25']).toBe(2);
    expect(list!.buckets['10']).toBe(1); // only the 8ms observation

    const create = snap.tools.find((t) => t.tool === 'create_task');
    expect(create).toMatchObject({ ok: 0, error: 1, denied: 1, durationMsSum: 40 });
  });

  it('renders Prometheus exposition with tool labels', () => {
    recordMcpToolCall('get_project', 'ok', 5);
    const text = renderPrometheus();
    expect(text).toContain('project_ops_mcp_tool_calls_total{tool="get_project",status="ok"} 1');
    expect(text).toContain('project_ops_mcp_tool_duration_ms_sum{tool="get_project"} 5');
    expect(text).toContain('project_ops_mcp_calls_total{status="ok"} 1');
    expect(text).toContain('# TYPE project_ops_mcp_tool_calls_total counter');
  });
});
