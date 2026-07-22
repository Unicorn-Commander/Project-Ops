import { Controller, Get, Header, Res } from '@nestjs/common';
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
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  check() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024), // 150MB
      () => this.memory.checkRSS('memory_rss', 300 * 1024 * 1024), // 300MB
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
