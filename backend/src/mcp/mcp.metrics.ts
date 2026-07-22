/**
 * Process-local MCP tool call metrics.
 *
 * Project-Ops already records successful tool calls as AgentEvents (durationMs)
 * when AgentsModule is wired, but that path is best-effort, success-only, and
 * not scrapable as ops metrics. This registry is the complementary ops surface:
 *
 *   - counters for ok / error / denied per tool
 *   - latency sum + count + simple buckets for p-ish inspection
 *   - structured log line per call (matches LoggingInterceptor style)
 *   - Prometheus text exposition via {@link renderPrometheus}
 *
 * No third-party metrics client — process-local so it is always on, even when
 * OTEL_ENABLED is false. Safe to call from the MCP registerTool gate on every
 * request path.
 */

export type McpMetricStatus = 'ok' | 'error' | 'denied';

export type McpToolStats = {
  tool: string;
  ok: number;
  error: number;
  denied: number;
  durationMsSum: number;
  durationMsCount: number;
  /** Fixed latency buckets (ms): count of observations ≤ each upper bound. */
  buckets: Record<string, number>;
};

const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

type InternalStats = {
  ok: number;
  error: number;
  denied: number;
  durationMsSum: number;
  durationMsCount: number;
  buckets: number[];
};

function emptyStats(): InternalStats {
  return {
    ok: 0,
    error: 0,
    denied: 0,
    durationMsSum: 0,
    durationMsCount: 0,
    buckets: LATENCY_BUCKETS_MS.map(() => 0),
  };
}

const byTool = new Map<string, InternalStats>();
let totalOk = 0;
let totalError = 0;
let totalDenied = 0;

function ensure(tool: string): InternalStats {
  let s = byTool.get(tool);
  if (!s) {
    s = emptyStats();
    byTool.set(tool, s);
  }
  return s;
}

/**
 * Record one MCP tool invocation. Call after the handler settles (ok result,
 * isError envelope, or thrown exception mapped to error).
 */
export function recordMcpToolCall(
  tool: string,
  status: McpMetricStatus,
  durationMs: number,
): void {
  const s = ensure(tool);
  const ms = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
  if (status === 'ok') {
    s.ok += 1;
    totalOk += 1;
  } else if (status === 'denied') {
    s.denied += 1;
    totalDenied += 1;
  } else {
    s.error += 1;
    totalError += 1;
  }
  s.durationMsSum += ms;
  s.durationMsCount += 1;
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
    if (ms <= LATENCY_BUCKETS_MS[i]) {
      s.buckets[i] += 1;
    }
  }
}

export function getMcpMetricsSnapshot(): {
  totals: { ok: number; error: number; denied: number; calls: number };
  tools: McpToolStats[];
} {
  const tools: McpToolStats[] = [];
  for (const [tool, s] of byTool.entries()) {
    const buckets: Record<string, number> = {};
    for (let i = 0; i < LATENCY_BUCKETS_MS.length; i++) {
      buckets[String(LATENCY_BUCKETS_MS[i])] = s.buckets[i];
    }
    tools.push({
      tool,
      ok: s.ok,
      error: s.error,
      denied: s.denied,
      durationMsSum: s.durationMsSum,
      durationMsCount: s.durationMsCount,
      buckets,
    });
  }
  tools.sort((a, b) => a.tool.localeCompare(b.tool));
  return {
    totals: {
      ok: totalOk,
      error: totalError,
      denied: totalDenied,
      calls: totalOk + totalError + totalDenied,
    },
    tools,
  };
}

/** Prometheus 0.0.4 text format (no extra deps). */
export function renderPrometheus(): string {
  const snap = getMcpMetricsSnapshot();
  const lines: string[] = [];
  lines.push('# HELP project_ops_mcp_tool_calls_total Total MCP tool invocations by tool and status');
  lines.push('# TYPE project_ops_mcp_tool_calls_total counter');
  for (const t of snap.tools) {
    lines.push(
      `project_ops_mcp_tool_calls_total{tool="${escapeLabel(t.tool)}",status="ok"} ${t.ok}`,
    );
    lines.push(
      `project_ops_mcp_tool_calls_total{tool="${escapeLabel(t.tool)}",status="error"} ${t.error}`,
    );
    lines.push(
      `project_ops_mcp_tool_calls_total{tool="${escapeLabel(t.tool)}",status="denied"} ${t.denied}`,
    );
  }

  lines.push(
    '# HELP project_ops_mcp_tool_duration_ms_sum Sum of MCP tool durations in milliseconds',
  );
  lines.push('# TYPE project_ops_mcp_tool_duration_ms_sum counter');
  lines.push(
    '# HELP project_ops_mcp_tool_duration_ms_count Count of MCP tool duration observations',
  );
  lines.push('# TYPE project_ops_mcp_tool_duration_ms_count counter');
  lines.push(
    '# HELP project_ops_mcp_tool_duration_ms_bucket MCP tool latency histogram (le = upper bound ms)',
  );
  lines.push('# TYPE project_ops_mcp_tool_duration_ms_bucket counter');
  for (const t of snap.tools) {
    const tool = escapeLabel(t.tool);
    lines.push(`project_ops_mcp_tool_duration_ms_sum{tool="${tool}"} ${t.durationMsSum}`);
    lines.push(`project_ops_mcp_tool_duration_ms_count{tool="${tool}"} ${t.durationMsCount}`);
    for (const [le, count] of Object.entries(t.buckets)) {
      lines.push(
        `project_ops_mcp_tool_duration_ms_bucket{tool="${tool}",le="${le}"} ${count}`,
      );
    }
    lines.push(
      `project_ops_mcp_tool_duration_ms_bucket{tool="${tool}",le="+Inf"} ${t.durationMsCount}`,
    );
  }

  lines.push('# HELP project_ops_mcp_calls_total Aggregate MCP tool invocations by status');
  lines.push('# TYPE project_ops_mcp_calls_total counter');
  lines.push(`project_ops_mcp_calls_total{status="ok"} ${snap.totals.ok}`);
  lines.push(`project_ops_mcp_calls_total{status="error"} ${snap.totals.error}`);
  lines.push(`project_ops_mcp_calls_total{status="denied"} ${snap.totals.denied}`);
  lines.push('');
  return lines.join('\n');
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Test-only: clear process counters between specs. */
export function resetMcpMetricsForTests(): void {
  byTool.clear();
  totalOk = 0;
  totalError = 0;
  totalDenied = 0;
}
