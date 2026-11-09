import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** The opaque virtual key returned for one org and one calling app. */
export type OrgGatewayKey = {
  key: string;
  expiresAt: string | number;
};

/** App-side seam for fetching an org-scoped gateway key. */
export interface OrgGatewayKeyProvider {
  getKey(orgId: string): Promise<OrgGatewayKey>;
}

export const ORG_GATEWAY_KEY_PROVIDER = Symbol('ORG_GATEWAY_KEY_PROVIDER');

/** A failure that must be surfaced instead of falling back to an instance host. */
export class OrgGatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrgGatewayError';
  }
}

type CachedKey = {
  value: OrgGatewayKey;
  cachedAt: number;
};

/**
 * v1 provider for Project-Ops. Ops-Center identifies the calling app from its
 * service credential and returns a key scoped to that app and organization.
 * Keys stay in this process only and are cached for no longer than ten minutes.
 */
@Injectable()
export class OpsCenterOrgGatewayKeyProvider implements OrgGatewayKeyProvider {
  private static readonly MAX_CACHE_MS = 10 * 60 * 1000;
  private readonly cache = new Map<string, CachedKey>();

  constructor(private readonly config: ConfigService) {}

  async getKey(orgId: string): Promise<OrgGatewayKey> {
    const normalizedOrgId = orgId.trim();
    if (!normalizedOrgId) {
      throw new OrgGatewayError('Project-Ops gateway key unavailable: organization is missing');
    }

    const now = Date.now();
    const cached = this.cache.get(normalizedOrgId);
    if (
      cached &&
      now - cached.cachedAt < OpsCenterOrgGatewayKeyProvider.MAX_CACHE_MS &&
      this.expiresAfter(cached.value.expiresAt, now)
    ) {
      return cached.value;
    }

    const internalUrl = this.config.get<string>('OPS_CENTER_INTERNAL_URL')?.trim();
    const serviceToken = this.config.get<string>('OPS_CENTER_SERVICE_TOKEN')?.trim();
    if (!internalUrl || !serviceToken) {
      throw new OrgGatewayError(
        'Project-Ops gateway key unavailable: Ops-Center key provider is not configured',
      );
    }

    const endpoint = `${internalUrl.replace(/\/+$/, '')}/api/v1/internal/orgs/${encodeURIComponent(
      normalizedOrgId,
    )}/gateway-key`;
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${serviceToken}`,
        },
      });
    } catch {
      throw new OrgGatewayError('Project-Ops gateway key unavailable: Ops-Center request failed');
    }

    if (!response.ok) {
      throw new OrgGatewayError(
        `Project-Ops gateway key unavailable: Ops-Center returned status ${response.status}`,
      );
    }

    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new OrgGatewayError('Project-Ops gateway key unavailable: invalid Ops-Center response');
    }

    const data = payload?.data ?? payload;
    const key = typeof data?.key === 'string' ? data.key.trim() : '';
    const expiresAt = data?.expiresAt ?? data?.expires_at;
    if (!key || (typeof expiresAt !== 'string' && typeof expiresAt !== 'number')) {
      throw new OrgGatewayError('Project-Ops gateway key unavailable: invalid Ops-Center key');
    }
    if (!this.expiresAfter(expiresAt, now)) {
      throw new OrgGatewayError('Project-Ops gateway key unavailable: Ops-Center key is expired');
    }

    const value = { key, expiresAt };
    this.cache.set(normalizedOrgId, { value, cachedAt: now });
    return value;
  }

  private expiresAfter(value: string | number, now: number): boolean {
    const timestamp =
      typeof value === 'number'
        ? value < 1_000_000_000_000
          ? value * 1000
          : value
        : Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > now;
  }
}
