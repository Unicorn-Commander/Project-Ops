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
  private readonly realmIssuer: string | null;
  private readonly brigadeJwksByIss: Map<string, JwksClient>;
  private readonly localSecret: string;
  private readonly brigadeTrustedIssuers: Set<string>;
  private readonly brigadeExpectedAudience: string;
  private readonly keycloakEnforceAudience: boolean;
  private readonly keycloakExpectedAudiences: Set<string>;

  constructor(
    configService: ConfigService,
    private authService: AuthService,
  ) {
    const localSecret = configService.get<string>('JWT_SECRET') || '';
    const realmJwksUri = JwtStrategy.buildJwksUri(configService);
    const realmIssuer = JwtStrategy.buildRealmIssuer(configService);
    const brigadeJwksByIss = JwtStrategy.buildBrigadeJwksClients(configService);
    // Audience-binding inputs (ported from the retired BrigadeJwtVerifier):
    // PO only accepts a federation token minted FOR project-ops. A token whose
    // `aud` is some other app (accounting-ops, meeting-ops, …) is rejected even
    // if its signature + issuer verify — see validate().
    const brigadeExpectedAudience =
      configService.get<string>('BRIGADE_EXPECTED_AUDIENCE') || 'project-ops';
    // Keycloak realm-token audience binding. The uchub realm is SHARED across
    // every UC app, so a realm RS256 token minted for a sibling client
    // (accounting-ops, meeting-ops, …) verifies against the same JWKS. Without
    // an `aud`/`azp` check, PO would accept it — a cross-app confused-deputy.
    // Default the allow-list to the PO Keycloak client id so dogfood keeps
    // working; tune via KEYCLOAK_EXPECTED_AUDIENCES (CSV) before flipping
    // enforcement off. See validate() for the claim semantics.
    const keycloakEnforceAudience = JwtStrategy.readBoolEnv(
      configService.get<string>('KEYCLOAK_ENFORCE_AUDIENCE'),
      true,
    );
    const keycloakExpectedAudiences = JwtStrategy.buildKeycloakExpectedAudiences(configService);

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
            typeof rawJwtToken === 'string' ? rawJwtToken : (rawJwtToken?.toString?.() ?? '');
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
    this.realmIssuer = realmIssuer;
    this.brigadeJwksByIss = brigadeJwksByIss;
    this.brigadeTrustedIssuers = new Set(brigadeJwksByIss.keys());
    this.brigadeExpectedAudience = brigadeExpectedAudience;
    this.keycloakEnforceAudience = keycloakEnforceAudience;
    this.keycloakExpectedAudiences = keycloakExpectedAudiences;

    if (realmJwksUri) {
      this.logger.log(`Keycloak realm JWT validation enabled via ${realmJwksUri}`);
      if (this.keycloakEnforceAudience) {
        this.logger.log(
          `Keycloak audience binding ENFORCED: a realm token's azp/aud must match one of [${[...this.keycloakExpectedAudiences].join(', ')}] (KEYCLOAK_EXPECTED_AUDIENCES)`,
        );
      } else {
        this.logger.warn(
          'Keycloak audience binding DISABLED (KEYCLOAK_ENFORCE_AUDIENCE=false): any realm-signed token in the shared uchub realm is accepted regardless of its target client',
        );
      }
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
      this.logger.log('Brigade federation JWT validation disabled (BRIGADE_TRUSTED_ISSUERS unset)');
    }
  }

  private static buildJwksUri(config: ConfigService): string | null {
    const base = (config.get<string>('KEYCLOAK_URL') || '').replace(/\/$/, '');
    const realm = config.get<string>('KEYCLOAK_REALM');
    if (!base || !realm) return null;
    return `${base}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/certs`;
  }

  /**
   * The canonical `iss` Keycloak stamps on realm tokens:
   * `<KEYCLOAK_URL>/realms/<KEYCLOAK_REALM>`. Used to positively identify a
   * realm token in validate() (so the audience gate runs ONLY for realm
   * tokens, never for local HS256 sessions whose `iss` is unset/different).
   */
  private static buildRealmIssuer(config: ConfigService): string | null {
    const base = (config.get<string>('KEYCLOAK_URL') || '').replace(/\/$/, '');
    const realm = config.get<string>('KEYCLOAK_REALM');
    if (!base || !realm) return null;
    return `${base}/realms/${realm}`;
  }

  private static readBoolEnv(value: string | undefined, fallback: boolean): boolean {
    if (value == null || value === '') return fallback;
    const s = value.trim().toLowerCase();
    if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
    if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
    return fallback;
  }

  /**
   * Allow-list of acceptable Keycloak `azp`/`aud` values for a realm token.
   * Defaults to the PO Keycloak client id (KEYCLOAK_CLIENT_ID, itself defaulting
   * to 'project-ops') so dogfood keeps working with zero new env. Override with
   * KEYCLOAK_EXPECTED_AUDIENCES (CSV) to accept additional clients (e.g. a
   * separate public-facing client id) — it is unioned with the client id.
   */
  private static buildKeycloakExpectedAudiences(config: ConfigService): Set<string> {
    const clientId = config.get<string>('KEYCLOAK_CLIENT_ID') || 'project-ops';
    const raw = config.get<string>('KEYCLOAK_EXPECTED_AUDIENCES');
    const set = new Set<string>([clientId]);
    if (raw) {
      for (const a of raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        set.add(a);
      }
    }
    return set;
  }

  /**
   * True iff the realm token presents an accepted client identity. Keycloak's
   * default token layout puts the OAuth client in `azp` (authorized party) and
   * often only `account` (the realm's default client) in `aud` — so a token
   * legitimately minted for PO frequently has `aud: "account"` and
   * `azp: "project-ops"`. We therefore accept a match in EITHER claim: `azp`
   * (preferred, single string) OR any entry of `aud` (string | string[]).
   * To bind a true `aud=project-ops`, add the PO client to the token's audience
   * in Keycloak (a dedicated audience mapper or the client's own scope); this
   * check passes for that layout too.
   */
  static keycloakAudienceMatches(aud: unknown, azp: unknown, expected: Set<string>): boolean {
    if (typeof azp === 'string' && expected.has(azp)) return true;
    if (typeof aud === 'string' && expected.has(aud)) return true;
    if (Array.isArray(aud)) {
      for (const a of aud) {
        if (typeof a === 'string' && expected.has(a)) return true;
      }
    }
    return false;
  }

  /**
   * Build a per-issuer JWKS client map from BRIGADE_TRUSTED_ISSUERS.
   * Each issuer's JWKS is fetched from `<iss>/.well-known/jwks.json` by
   * convention (matches the Brigade federation spec). Default is the
   * customer-facing prod broker. Set the env to "" to disable.
   */
  private static buildBrigadeJwksClients(config: ConfigService): Map<string, JwksClient> {
    const raw = config.get<string>('BRIGADE_TRUSTED_ISSUERS');
    const source = raw === undefined || raw === null ? 'https://brigade.unicorncommander.ai' : raw;
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
      } else if (
        // Keycloak realm token (signature already verified against the realm
        // JWKS). The uchub realm is shared across the suite, so we MUST also
        // bind the token to THIS app by its `azp`/`aud` — otherwise a token
        // minted for a sibling client in the same realm would be accepted
        // (cross-app confused-deputy). Gated by KEYCLOAK_ENFORCE_AUDIENCE.
        this.keycloakEnforceAudience &&
        typeof issuer === 'string' &&
        this.realmIssuer != null &&
        issuer === this.realmIssuer
      ) {
        if (
          !JwtStrategy.keycloakAudienceMatches(
            payload?.aud,
            payload?.azp,
            this.keycloakExpectedAudiences,
          )
        ) {
          this.logger.warn(
            `Rejected Keycloak realm token: azp=${JSON.stringify(payload?.azp)} aud=${JSON.stringify(payload?.aud)} matches none of [${[...this.keycloakExpectedAudiences].join(', ')}]`,
          );
          throw new UnauthorizedException('Token is not authorized for project-ops');
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
      augmented.__workspaceClaim = payload?.workspace_id ?? payload?.tenant_id ?? null;
      // The acting uchub subject for app.uc_uid attribution + Membership key.
      augmented.__ucUid = typeof payload?.sub === 'string' ? payload.sub : null;
      return user;
    } catch (error) {
      this.logger.warn(`JWT validation failed: ${(error as Error).message ?? 'unknown'}`);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
