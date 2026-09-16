import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { PrismaService } from '../prisma/prisma.service';

export type IntegrationStatus = 'ok' | 'down' | 'not_configured';

export interface IntegrationResult {
  name: string;
  status: IntegrationStatus;
  configured: boolean;
  detail?: string;
  latencyMs?: number;
}

export interface IntegrationsReport {
  status: 'healthy' | 'degraded';
  timestamp: string;
  integrations: Record<string, IntegrationResult>;
}

/**
 * Lightweight, NON-throwing diagnostics for PO's external integrations. Unlike
 * the terminus /health (which 503s the container), this is an operator-facing
 * report that always returns 200 with a per-integration {status, detail}. A
 * configured-but-unreachable dependency is `down`; an unset optional one is
 * `not_configured` (not a failure). Probes are config+reachability only — fast
 * timeouts, no writes.
 */
@Injectable()
export class IntegrationsHealthService {
  private readonly logger = new Logger(IntegrationsHealthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async check(): Promise<IntegrationsReport> {
    const [database, keycloak, brigade, registry, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkKeycloak(),
      this.checkBrigade(),
      this.checkRegistry(),
      this.checkStorage(),
    ]);
    const integrations = { database, keycloak, brigade, registry, storage };
    // Degraded only when a CONFIGURED integration is unreachable. An unset
    // optional integration (not_configured) is expected, not a failure.
    const degraded = Object.values(integrations).some((i) => i.status === 'down');
    return {
      status: degraded ? 'degraded' : 'healthy',
      timestamp: new Date().toISOString(),
      integrations,
    };
  }

  /** GET probe that resolves with the HTTP status (any response = reachable). */
  private async fetchProbe(
    url: string,
    timeoutMs: number,
  ): Promise<{ ms: number; code?: number; error?: string }> {
    const start = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      return { ms: Date.now() - start, code: res.status };
    } catch (e) {
      return { ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async checkDatabase(): Promise<IntegrationResult> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { name: 'database', configured: true, status: 'ok', latencyMs: Date.now() - start };
    } catch (e) {
      return {
        name: 'database',
        configured: true,
        status: 'down',
        detail: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }

  private async checkKeycloak(): Promise<IntegrationResult> {
    const url = this.config.get<string>('KEYCLOAK_URL');
    const realm = this.config.get<string>('KEYCLOAK_REALM');
    if (!url || !realm) {
      return { name: 'keycloak', configured: false, status: 'not_configured' };
    }
    const probe = `${url.replace(/\/$/, '')}/realms/${encodeURIComponent(realm)}`;
    const r = await this.fetchProbe(probe, 3000);
    const reachable = r.code !== undefined; // any HTTP response (200/401/...) = up
    return {
      name: 'keycloak',
      configured: true,
      status: reachable ? 'ok' : 'down',
      detail: reachable ? `realm endpoint HTTP ${r.code}` : r.error,
      latencyMs: r.ms,
    };
  }

  private async checkBrigade(): Promise<IntegrationResult> {
    const url = this.config.get<string>('BRIGADE_URL');
    const apiKey = this.config.get<string>('BRIGADE_API_KEY');
    if (!url) {
      return {
        name: 'brigade',
        configured: false,
        status: 'not_configured',
        detail: 'BRIGADE_URL unset',
      };
    }
    if (!apiKey) {
      return {
        name: 'brigade',
        configured: false,
        status: 'not_configured',
        detail: 'BRIGADE_API_KEY unset — assistant cannot call Brigade',
      };
    }
    const base = url.replace(/\/$/, '');
    let r = await this.fetchProbe(`${base}/.well-known/health`, 3000);
    if (r.code === undefined) r = await this.fetchProbe(base, 3000); // fall back to base reachability
    const reachable = r.code !== undefined;
    return {
      name: 'brigade',
      configured: true,
      status: reachable ? 'ok' : 'down',
      detail: reachable ? `HTTP ${r.code}` : r.error,
      latencyMs: r.ms,
    };
  }

  private async checkRegistry(): Promise<IntegrationResult> {
    const url = this.config.get<string>('UC_REGISTRY_URL');
    if (!url) {
      return {
        name: 'registry',
        configured: false,
        status: 'not_configured',
        detail: 'UC_REGISTRY_URL unset (workspace SoR inert)',
      };
    }
    const timeout = Number(this.config.get('UC_REGISTRY_TIMEOUT_MS') ?? 5000);
    const base = url.replace(/\/$/, '');
    let r = await this.fetchProbe(`${base}/.well-known/jwks.json`, timeout);
    if (r.code === undefined) r = await this.fetchProbe(`${base}/health`, timeout);
    const reachable = r.code !== undefined;
    return {
      name: 'registry',
      configured: true,
      status: reachable ? 'ok' : 'down',
      detail: reachable ? `HTTP ${r.code}` : r.error,
      latencyMs: r.ms,
    };
  }

  private async checkStorage(): Promise<IntegrationResult> {
    const endpoint = this.config.get<string>('MINIO_ENDPOINT');
    const accessKey = this.config.get<string>('MINIO_ACCESS_KEY');
    const secretKey = this.config.get<string>('MINIO_SECRET_KEY');
    const bucket = this.config.get<string>('MINIO_BUCKET_NAME') || 'project-ops-documents';
    if (!endpoint || !accessKey || !secretKey || endpoint.startsWith('placeholder')) {
      return {
        name: 'storage',
        configured: false,
        status: 'not_configured',
        detail: 'MINIO_* unset or placeholder',
      };
    }
    const start = Date.now();
    try {
      const client = new Minio.Client({
        endPoint: endpoint,
        port: Number(this.config.get('MINIO_PORT') ?? 3900),
        useSSL: String(this.config.get('MINIO_USE_SSL')) === 'true',
        accessKey,
        secretKey,
      });
      const exists = await Promise.race([
        client.bucketExists(bucket),
        new Promise<boolean>((_, reject) =>
          setTimeout(() => reject(new Error('timeout after 3000ms')), 3000),
        ),
      ]);
      return {
        name: 'storage',
        configured: true,
        status: exists ? 'ok' : 'down',
        detail: exists ? `bucket "${bucket}" reachable` : `bucket "${bucket}" missing`,
        latencyMs: Date.now() - start,
      };
    } catch (e) {
      return {
        name: 'storage',
        configured: true,
        status: 'down',
        detail: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - start,
      };
    }
  }
}
