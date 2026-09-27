import { Injectable } from '@nestjs/common';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { Reflector } from '@nestjs/core';
import { isIP } from 'node:net';

const DEFAULT_TRUSTED_PROXY_CIDRS = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '127.0.0.0/8',
  '::1/128',
  'fc00::/7',
];

/**
 * Throttling tracker for the real caller rather than the last reverse proxy.
 *
 * This guard is intentionally installed after JwtAuthGuard in AppModule. That
 * means req.user and req.pat are only used after the normal signature/PAT
 * verification path has completed. No bearer token is decoded here: a public
 * request, rejected credential, or otherwise unverifiable token is keyed by a
 * trusted forwarded address or the socket address instead.
 */
@Injectable()
export class PrincipalThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const patId = readString(req.pat?.id);
    if (patId) return `pat:${patId}`;

    const user = req.user;
    const principalId =
      readString(user?.__ucUid) || readString(user?.keycloakId) || readString(user?.id);
    if (principalId) return `user:${principalId}`;

    return `ip:${resolveClientIp(req)}`;
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveClientIp(req: Record<string, any>): string {
  const peer = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress);
  if (!peer || !isTrustedProxy(peer)) return peer || normalizeIp(req.ip) || 'unknown';

  const forwarded = firstValidIp(req.headers?.['cf-connecting-ip']);
  if (forwarded) return forwarded;

  const xForwardedFor = req.headers?.['x-forwarded-for'];
  const firstForwarded = Array.isArray(xForwardedFor)
    ? xForwardedFor[0]
    : typeof xForwardedFor === 'string'
      ? xForwardedFor.split(',')[0]
      : undefined;
  return firstValidIp(firstForwarded) || peer;
}

function firstValidIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = normalizeIp(value.split(',')[0]);
  return candidate && isIP(candidate) ? candidate : null;
}

function normalizeIp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!candidate) return null;
  if (candidate.startsWith('::ffff:')) return candidate.slice('::ffff:'.length);
  return isIP(candidate) ? candidate : null;
}

function isTrustedProxy(ip: string): boolean {
  const configured = process.env.TRUSTED_PROXY_CIDRS;
  const cidrs = configured === undefined
    ? DEFAULT_TRUSTED_PROXY_CIDRS
    : configured.split(',').map((value) => value.trim()).filter(Boolean);
  return cidrs.some((cidr) => ipInCidr(ip, cidr));
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split('/', 2);
  const networkIp = normalizeIp(network);
  const bits = isIP(ip);
  const networkBits = networkIp ? isIP(networkIp) : 0;
  if (!bits || bits !== networkBits) return false;

  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits * 8) return false;

  const ipBytes = ipToBytes(ip);
  const networkBytes = ipToBytes(networkIp!);
  let remaining = prefix;
  for (let index = 0; index < ipBytes.length; index += 1) {
    const comparedBits = Math.min(remaining, 8);
    if (comparedBits > 0) {
      const mask = (0xff << (8 - comparedBits)) & 0xff;
      if ((ipBytes[index] & mask) !== (networkBytes[index] & mask)) return false;
    }
    remaining -= comparedBits;
  }
  return true;
}

function ipToBytes(ip: string): number[] {
  if (isIP(ip) === 4) return ip.split('.').map(Number);

  const halves = ip.split('::');
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  return groups.flatMap((group) => {
    const value = parseInt(group || '0', 16);
    return [(value >> 8) & 0xff, value & 0xff];
  });
}
