import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import * as jsonwebtoken from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';
import { AuthService, JwtPayload } from '../auth.service';
import { User } from '@prisma/client';

/**
 * Multi-token JWT strategy.
 *
 * Accepts:
 * 1. Locally-signed HS256 JWTs (existing browser flow — issued by
 *    AuthService after the user logs in via Keycloak OIDC callback).
 * 2. Keycloak realm-signed RS256 JWTs (cross-app federation flow — used
 *    by other ecosystem services that forward the user's realm token).
 * 3. Brigade federation broker RS256 JWTs (Brigade-brokered MCP calls
 *    from customer-facing clients via brigade.unicorncommander.ai).
 *
 * The signing key resolves by `iss` + `alg` inspection at request time:
 *   HS256                            -> ConfigService.get('JWT_SECRET')
 *   RS256 + iss in BRIGADE_TRUSTED   -> Brigade JWKS (per-issuer client)
 *   RS256 (other)                    -> Keycloak realm JWKS
 *
 * AuthService.validateJwtPayload then disambiguates payload shapes by
 * the `iss` claim and JIT-provisions a project-ops User row when needed
 * (gated by access-list, same rules as the /auth/keycloak browser
 * callback).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly jwks?: JwksClient;
  private readonly brigadeJwksByIss: Map<string, JwksClient>;
  private readonly localSecret: string;
  private readonly brigadeTrustedIssuers: Set<string>;
  private readonly brigadeExpectedAudience: string;

  constructor(
    configService: ConfigService,
    private authService: AuthService,
  ) {
    const localSecret = configService.get<string>('JWT_SECRET') || '';
    const realmJwksUri = JwtStrategy.buildJwksUri(configService);
    const brigadeJwksByIss = JwtStrategy.buildBrigadeJwksClients(configService);
    // Audience-binding inputs (ported from the retired BrigadeJwtVerifier):
    // PO only accepts a federation token minted FOR project-ops. A token whose
    // `aud` is some other app (accounting-ops, meeting-ops, …) is rejected even
    // if its signature + issuer verify — see validate().
    const brigadeExpectedAudience =
      configService.get<string>('BRIGADE_EXPECTED_AUDIENCE') || 'project-ops';

    let jwks: JwksClient | undefined;
    if (realmJwksUri) {
      jwks = jwksClient({
        jwksUri: realmJwksUri,
        cache: true,
        cacheMaxAge: 10 * 60 * 1000, // 10 minutes
        rateLimit: true,
        jwksRequestsPerMinute: 12,
      });
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // secretOrKeyProvider runs per-request; we inspect the JWT header
      // + payload and resolve the right key on the fly. Provider must
      // call done(err, key).
      secretOrKeyProvider: (
        _request: any,
        rawJwtToken: any,
        done: (err: any, secretOrKey?: string | Buffer) => void,
      ) => {
        try {
          const token =
            typeof rawJwtToken === 'string'
              ? rawJwtToken
              : (rawJwtToken?.toString?.() ?? '');
          const decoded: any = jsonwebtoken.decode(token, { complete: true });
          const alg = decoded?.header?.alg;
          const kid = decoded?.header?.kid;
          const iss: string | undefined = decoded?.payload?.iss;

          // RS256 + Brigade-trusted-issuer -> per-issuer Brigade JWKS
          if (alg === 'RS256' && kid && iss && brigadeJwksByIss.has(iss)) {
            const client = brigadeJwksByIss.get(iss)!;
            client.getSigningKey(kid, (err, key) => {
              if (err || !key) {
                done(err || new Error('Brigade signing key not found'));
                return;
              }
              done(null, key.getPublicKey());
            });
            return;
          }

          // RS256 + valid kid -> Keycloak realm JWKS (default RS256 branch)
          if (alg === 'RS256' && kid && jwks) {
            jwks.getSigningKey(kid, (err, key) => {
              if (err || !key) {
                done(err || new Error('signing key not found'));
                return;
              }
              done(null, key.getPublicKey());
            });
            return;
          }
          // Default: locally-signed HS256 JWT
          done(null, localSecret);
        } catch (err) {
          done(err);
        }
      },
    });

    this.localSecret = localSecret;
    this.jwks = jwks;
    this.brigadeJwksByIss = brigadeJwksByIss;
    this.brigadeTrustedIssuers = new Set(brigadeJwksByIss.keys());
    this.brigadeExpectedAudience = brigadeExpectedAudience;

    if (realmJwksUri) {
      this.logger.log(
        `Keycloak realm JWT validation enabled via ${realmJwksUri}`,
      );
    } else {
      this.logger.log(
        'Keycloak realm JWT validation disabled (KEYCLOAK_URL/KEYCLOAK_REALM not set)',
      );
    }
    if (brigadeJwksByIss.size > 0) {
      this.logger.log(
        `Brigade federation JWT validation enabled for ${brigadeJwksByIss.size} issuer(s): ${[...brigadeJwksByIss.keys()].join(', ')}`,
      );
    } else {
      this.logger.log(
        'Brigade federation JWT validation disabled (BRIGADE_TRUSTED_ISSUERS unset)',
      );
    }
  }

  private static buildJwksUri(config: ConfigService): string | null {
    const base = (config.get<string>('KEYCLOAK_URL') || '').replace(/\/$/, '');
    const realm = config.get<string>('KEYCLOAK_REALM');
    if (!base || !realm) return null;
    return `${base}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/certs`;
  }

  /**
   * Build a per-issuer JWKS client map from BRIGADE_TRUSTED_ISSUERS.
   * Each issuer's JWKS is fetched from `<iss>/.well-known/jwks.json` by
   * convention (matches the Brigade federation spec). Default is the
   * customer-facing prod broker. Set the env to "" to disable.
   */
  private static buildBrigadeJwksClients(
    config: ConfigService,
  ): Map<string, JwksClient> {
    const raw = config.get<string>('BRIGADE_TRUSTED_ISSUERS');
    const source =
      raw === undefined || raw === null
        ? 'https://brigade.unicorncommander.ai'
        : raw;
    const issuers = source
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean);

    const map = new Map<string, JwksClient>();
    for (const iss of issuers) {
      map.set(
        iss,
        jwksClient({
          jwksUri: `${iss}/.well-known/jwks.json`,
          cache: true,
          cacheMaxAge: 10 * 60 * 1000, // 10 minutes
          rateLimit: true,
          jwksRequestsPerMinute: 12,
        }),
      );
    }
    return map;
  }

  /**
   * Audience-binding check (ported from the retired BrigadeJwtVerifier's
   * `validateClaims`). A federation token minted for another app
   * (`aud=accounting-ops`, etc.) MUST be rejected by Project-Ops even though
   * its signature + issuer verify — this is the cross-app fence in
   * SUITE-IDENTITY §9.4. `aud` may be a string or an array (RFC 7519).
   */
  static audienceMatches(aud: unknown, expected: string): boolean {
    if (Array.isArray(aud)) return aud.includes(expected);
    return aud === expected;
  }

  async validate(payload: any): Promise<User> {
    try {
      // Brigade federation tokens are bound to a single app by `aud`. We only
      // reach validate() after the signature + issuer already verified, so any
      // token whose `iss` is a trusted Brigade broker is a federation token:
      // enforce that its audience is THIS app before resolving the user. (Local
      // HS256 + Keycloak-realm tokens have a non-Brigade `iss` and are
      // unaffected — they carry no app-scoped `aud`.)
      const issuer: string | undefined = payload?.iss;
      if (typeof issuer === 'string' && this.brigadeTrustedIssuers.has(issuer)) {
        if (!JwtStrategy.audienceMatches(payload?.aud, this.brigadeExpectedAudience)) {
          this.logger.warn(
            `Rejected Brigade token: aud=${JSON.stringify(payload?.aud)} != ${this.brigadeExpectedAudience}`,
          );
          throw new UnauthorizedException('Token audience is not project-ops');
        }
      }

      const user = await this.authService.validateJwtPayload(payload as JwtPayload);
      // Surface the suite-canonical workspace/tenant claim (if any) on the
      // resolved user so the tenancy seam (WorkspaceContextService /
      // @CurrentWorkspace) can scope rows without trusting an HTTP header.
      // Tokens that don't carry it fall back to DEFAULT_WORKSPACE_ID.
      const augmented = user as User & {
        __workspaceClaim?: string | null;
        __ucUid?: string | null;
      };
      augmented.__workspaceClaim =
        payload?.workspace_id ?? payload?.tenant_id ?? null;
      // The acting uchub subject for app.uc_uid attribution + Membership key.
      augmented.__ucUid =
        typeof payload?.sub === 'string' ? payload.sub : null;
      return user;
    } catch (error) {
      this.logger.warn(
        `JWT validation failed: ${(error as Error).message ?? 'unknown'}`,
      );
      throw new UnauthorizedException('Invalid token');
    }
  }
}
