import { Controller, Get, Header, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  HttpHealthIndicator,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { Response } from 'express';
import { PrismaHealthIndicator } from './prisma.health';
import { IntegrationsHealthService } from './integrations.health';
import { Public } from '../common/decorators/public.decorator';
import { SkipWorkspaceMembership } from '../common/workspace/skip-workspace-membership.decorator';
import { getMcpMetricsSnapshot, renderPrometheus } from '../mcp/mcp.metrics';

/**
 * Resolve a memory limit (in MB) from configuration with a safe default.
 *
 * Only a plain positive decimal (e.g. `512`, `"2048"`) is accepted, matching
 * the `@IsInt() @Min(1)` gate in env.validation.ts. Anything else — missing,
 * empty, non-numeric, zero, negative, `"0x10"`, `"1e30"`, `"true"` — falls
 * back to `defaultMb` rather than weakening or disabling the guardrail, so a
 * malformed env var can never take the health endpoint down. Exported for the
 * spec.
 */
export function resolveMemoryLimitBytes(
  config: Pick<ConfigService, 'get'>,
  key: string,
  defaultMb: number,
): number {
  const raw = config.get<string | number>(key);
  const asString = typeof raw === 'number' ? String(raw) : raw;
  if (typeof asString !== 'string' || !/^\d+$/.test(asString.trim())) {
    return defaultMb * 1024 * 1024;
  }
  const mb = Number(asString.trim());
  if (!Number.isSafeInteger(mb) || mb <= 0) {
    return defaultMb * 1024 * 1024;
  }
  return mb * 1024 * 1024;
}

@ApiTags('health')
// Unauthenticated probe surface: opt out of the global auth + membership guards
// so container / load-balancer probes don't 401/403.
@Public()
@SkipWorkspaceMembership()
// Probes run far more often than the human tiers allow; skip them so a busy
// load balancer never 429s the healthcheck. (Named throttlers require an
// explicit map in @nestjs/throttler v5 — bare @SkipThrottle() is a no-op.)
@SkipThrottle({ short: true, long: true })
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
    private prismaHealth: PrismaHealthIndicator,
    private integrationsHealth: IntegrationsHealthService,
    private config: ConfigService,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  check() {
    return this.health.check([
      // The database check stays strict — it is the one signal that should
      // fail the probe when the service truly cannot serve traffic.
      () => this.prismaHealth.isHealthy('database'),
      // Memory thresholds are guardrails against runaway growth, not a
      // measure of normal steady state. They were once hardcoded at 150 MB
      // heap / 300 MB RSS — below the app's ordinary working set (RSS ~217 MB
      // observed 2026-08) — which made /api/v1/health flap to `error` on a
      // healthy service under load (docker-compose.yml even had to switch its
      // probe to /health/live as a workaround). The values are now the
      // realistic 1 GiB / 2 GiB defaults *and* env-tunable, so a deploy can
      // raise them without a code change or rebuild.
      () =>
        this.memory.checkHeap(
          'memory_heap',
          resolveMemoryLimitBytes(this.config, 'HEALTH_MEMORY_HEAP_MB', 1024),
        ),
      () =>
        this.memory.checkRSS(
          'memory_rss',
          resolveMemoryLimitBytes(this.config, 'HEALTH_MEMORY_RSS_MB', 2048),
        ),
    ]);
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Service is live' })
  liveness() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  @ApiResponse({ status: 503, description: 'Service is not ready' })
  readiness() {
    return this.health.check([() => this.prismaHealth.isHealthy('database')]);
  }

  @Get('integrations')
  @ApiOperation({
    summary: 'External integration status (DB, Keycloak, Brigade, registry, storage)',
  })
  @ApiResponse({ status: 200, description: 'Per-integration status report (always 200)' })
  integrations() {
    // Operator diagnostics: always 200, with per-integration ok/down/not_configured.
    return this.integrationsHealth.check();
  }

  /**
   * MCP tool latency / error counters (process-local). Complements AgentEvent
   * capture (success-only product feed) with scrapable ops metrics for every
   * tool call, including denied + thrown errors. See backend/src/mcp/mcp.metrics.ts.
   */
  @Get('mcp-metrics')
  @ApiOperation({
    summary: 'MCP tool call counters + latency snapshot (JSON)',
  })
  @ApiResponse({ status: 200, description: 'Process-local MCP metrics snapshot' })
  mcpMetrics() {
    return getMcpMetricsSnapshot();
  }

  @Get('mcp-metrics/prometheus')
  @ApiOperation({
    summary: 'MCP tool call metrics in Prometheus text format',
  })
  @ApiResponse({ status: 200, description: 'Prometheus 0.0.4 exposition' })
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  mcpMetricsPrometheus(@Res() res: Response) {
    res.type('text/plain; version=0.0.4; charset=utf-8').send(renderPrometheus());
  }
}
