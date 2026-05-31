import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'crypto';

/**
 * Brigade federation JWT verifier (Phase 2, currently DARK).
 *
 * Per BRIGADE-FEDERATION-SPEC.md, suite customers hit ONE Brigade credential
 * and Brigade calls each UC app's REST API with a Brigade-signed JWT in the
 * Authorization header. This service verifies those JWTs so Project-Ops can
 * resolve the caller without a per-app PAT.
 *
 * STATUS: not wired into the live auth chain yet. As of 2026-05-30 the Brigade
 * broker is unbuilt -- `https://brigade.unicorncommander.ai/.well-known/jwks.json`
 * returns 502, there is no JWT mint, and no federated-apps registration. This
 * verifier is fully implemented + unit-tested against a mocked JWKS so it is
 * ready to activate the moment Brigade ships its half.
 *
 * Implementation notes:
 *  - Verifies with Node's built-in `crypto` only (no new deps, no ESM-only
 *    packages -- the backend compiles to CommonJS). `crypto.createPublicKey`
 *    imports RSA / EC / OKP(Ed25519) JWKs and `crypto.verify` checks both an
 *    Ed25519 ('EdDSA') and an RSA-SHA256 ('RS256') signature, covering the two
 *    algorithms the spec asks for. (jsonwebtoken was ruled out: it cannot do
 *    EdDSA; jose v6 was ruled out: it is ESM-only and breaks the CJS runtime.)
 *  - JWKS is fetched and cached with a 24h TTL and re-fetched on an unknown
 *    `kid` (rate-limited by a short cooldown), per the spec's rotation rule.
 *
 * TO ACTIVATE (do NOT until Brigade's JWKS is live and a real test JWT exists):
 *   1. Provide BrigadeJwtVerifier in AuthModule.
 *   2. In JwtStrategy.secretOrKeyProvider, when the JWT header alg is 'EdDSA'
 *      (or iss === BRIGADE_TRUSTED_ISSUER), resolve the signing key via this
 *      verifier instead of the Keycloak/local secret.
 *   3. In JwtStrategy.validate, when the payload's iss is Brigade, resolve the
 *      User by `sub` (Brigade puts the project-ops user-id in `sub`) and the
 *      Organization by `org_id`, enforcing `scopes` for the endpoint.
 *   4. Run the 8 spec test cases against a real Brigade JWT.
 *
 * Auth fall-through order (unchanged existing paths + the NEW Brigade path):
 *   1. Local HS256 session JWT   (existing)
 *   2. Keycloak realm RS256 JWT  (existing)
 *   3. Brigade federation JWT    (NEW, this service)
 *   4. 401
 */

export interface BrigadeClaims {
  sub: string;
  iss?: string;
  aud?: string | string[];
  org_id?: string;
  scopes?: string[] | string;
  exp?: number;
  nbf?: number;
  iat?: number;
  [key: string]: unknown;
}

type Jwk = Record<string, unknown> & { kid?: string; alg?: string };
export type JwksFetcher = () => Promise<{ keys: Jwk[] }>;

export const BRIGADE_ALLOWED_ALGS = ['EdDSA', 'RS256'] as const;
type BrigadeAlg = (typeof BRIGADE_ALLOWED_ALGS)[number];
const JWKS_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const REFETCH_COOLDOWN_MS = 30 * 1000;

@Injectable()
export class BrigadeJwtVerifier {
  private readonly logger = new Logger(BrigadeJwtVerifier.name);
  private readonly issuer: string;
  private readonly audience: string;
  private readonly jwksUrl: string;
  private readonly fetchJwks: JwksFetcher;

  private cache: { keys: Jwk[]; fetchedAt: number } = { keys: [], fetchedAt: 0 };
  private lastFetchAttempt = 0;

  /**
   * @param jwksFetcher optional override (tests inject an in-memory JWKS).
   *        When omitted, the JWKS is fetched from BRIGADE_JWKS_URL over HTTPS.
   */
  constructor(config: ConfigService, jwksFetcher?: JwksFetcher) {
    this.issuer = config.get<string>(
      'BRIGADE_TRUSTED_ISSUER',
      'https://brigade.unicorncommander.ai',
    );
    this.audience = config.get<string>(
      'BRIGADE_EXPECTED_AUDIENCE',
      'project-ops',
    );
    this.jwksUrl = config.get<string>(
      'BRIGADE_JWKS_URL',
      `${this.issuer}/.well-known/jwks.json`,
    );
    this.fetchJwks =
      jwksFetcher ??
      (async () => {
        const res = await fetch(this.jwksUrl, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`JWKS fetch ${res.status}`);
        return (await res.json()) as { keys: Jwk[] };
      });
  }

  /**
   * Returns the validated claims for a Brigade-signed JWT, or null on any
   * failure (bad signature, wrong issuer/audience, expired, not-yet-valid,
   * unknown key, disallowed alg). Never throws -- callers treat null as "not a
   * valid Brigade token" and fall through.
   */
  async verify(token: string): Promise<BrigadeClaims | null> {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [headerB64, payloadB64, sigB64] = parts;

      const header = JSON.parse(
        Buffer.from(headerB64, 'base64url').toString('utf8'),
      ) as { alg?: string; kid?: string };
      const alg = header.alg;
      if (!alg || !BRIGADE_ALLOWED_ALGS.includes(alg as BrigadeAlg)) {
        return null;
      }

      const jwk = await this.resolveKey(header.kid);
      if (!jwk) return null;
      const publicKey = createPublicKey({ key: jwk as any, format: 'jwk' });

      const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
      const signature = Buffer.from(sigB64, 'base64url');
      if (!this.verifySignature(alg as BrigadeAlg, signingInput, publicKey, signature)) {
        return null;
      }

      const claims = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString('utf8'),
      ) as BrigadeClaims;
      if (!this.validateClaims(claims)) return null;
      return claims;
    } catch (err) {
      this.logger.debug(
        `Brigade JWT rejected: ${(err as Error).message ?? 'unknown'}`,
      );
      return null;
    }
  }

  private verifySignature(
    alg: BrigadeAlg,
    signingInput: Buffer,
    key: KeyObject,
    signature: Buffer,
  ): boolean {
    // EdDSA: algorithm arg must be null. RS256: RSA with SHA-256.
    if (alg === 'EdDSA') {
      return cryptoVerify(null, signingInput, key, signature);
    }
    return cryptoVerify('RSA-SHA256', signingInput, key, signature);
  }

  /** iss / aud / exp / nbf / sub checks with a 30s clock-skew allowance. */
  private validateClaims(claims: BrigadeClaims): boolean {
    if (!claims.sub) return false;
    if (claims.iss !== this.issuer) return false;
    const aud = claims.aud;
    const audMatch = Array.isArray(aud)
      ? aud.includes(this.audience)
      : aud === this.audience;
    if (!audMatch) return false;
    const now = Math.floor(Date.now() / 1000);
    const skew = 30;
    if (typeof claims.exp === 'number' && now > claims.exp + skew) return false;
    if (typeof claims.nbf === 'number' && now < claims.nbf - skew) return false;
    return true;
  }

  /** Resolve a signing key by kid, refreshing the JWKS on miss/expiry. */
  private async resolveKey(kid?: string): Promise<Jwk | undefined> {
    const fresh = Date.now() - this.cache.fetchedAt < JWKS_TTL_MS;
    let key = fresh ? this.findKey(kid) : undefined;
    if (key) return key;

    // Stale cache, or unknown kid (possible rotation) -> refetch, with cooldown.
    if (Date.now() - this.lastFetchAttempt < REFETCH_COOLDOWN_MS && fresh) {
      return undefined;
    }
    this.lastFetchAttempt = Date.now();
    try {
      const { keys } = await this.fetchJwks();
      this.cache = { keys: keys ?? [], fetchedAt: Date.now() };
    } catch (err) {
      this.logger.warn(`Brigade JWKS refresh failed: ${(err as Error).message}`);
      if (!fresh) return undefined; // can't verify without keys
    }
    key = this.findKey(kid);
    return key;
  }

  private findKey(kid?: string): Jwk | undefined {
    if (kid) return this.cache.keys.find((k) => k.kid === kid);
    // No kid in header: only safe if exactly one key is published.
    return this.cache.keys.length === 1 ? this.cache.keys[0] : undefined;
  }

  /** True if the claims carry the scope an endpoint requires. */
  static hasScope(claims: BrigadeClaims, required: string): boolean {
    const raw = claims.scopes;
    const granted = Array.isArray(raw)
      ? raw
      : typeof raw === 'string'
        ? raw.split(/\s+/).filter(Boolean)
        : [];
    return granted.includes(required);
  }
}
