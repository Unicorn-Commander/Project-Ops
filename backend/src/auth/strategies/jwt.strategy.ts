import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import * as jsonwebtoken from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';
import { AuthService, JwtPayload } from '../auth.service';
import { User } from '@prisma/client';

/**
 * Dual-token JWT strategy.
 *
 * Accepts BOTH:
 * 1. Locally-signed HS256 JWTs (existing browser flow — issued by
 *    AuthService after the user logs in via Keycloak OIDC callback).
 * 2. Keycloak realm-signed RS256 JWTs (cross-app federation flow — used
 *    by other ecosystem services that forward the user's realm token
 *    server-to-server, eg meeting-ops linking to project-ops projects).
 *
 * The token's `alg` header chooses the validation key:
 *   HS256 -> ConfigService.get('JWT_SECRET')           (existing)
 *   RS256 -> jwksClient.getSigningKey(kid).publicKey   (new)
 *
 * AuthService.validateJwtPayload disambiguates the two payload shapes by
 * the `iss` claim and JIT-provisions a project-ops User row when a
 * Keycloak token arrives without one (gated by access-list, same rules
 * as the existing /auth/keycloak browser callback).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly jwks?: JwksClient;
  private readonly localSecret: string;

  constructor(
    configService: ConfigService,
    private authService: AuthService,
  ) {
    const localSecret = configService.get<string>('JWT_SECRET') || '';
    const realmJwksUri = JwtStrategy.buildJwksUri(configService);

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
      // and resolve the right key on the fly. Provider must call done(err, key).
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
    if (realmJwksUri) {
      this.logger.log(
        `Keycloak realm JWT validation enabled via ${realmJwksUri}`,
      );
    } else {
      this.logger.log(
        'Keycloak realm JWT validation disabled (KEYCLOAK_URL/KEYCLOAK_REALM not set)',
      );
    }
  }

  private static buildJwksUri(config: ConfigService): string | null {
    const base = (config.get<string>('KEYCLOAK_URL') || '').replace(/\/$/, '');
    const realm = config.get<string>('KEYCLOAK_REALM');
    if (!base || !realm) return null;
    return `${base}/realms/${encodeURIComponent(realm)}/protocol/openid-connect/certs`;
  }

  async validate(payload: any): Promise<User> {
    try {
      return await this.authService.validateJwtPayload(payload as JwtPayload);
    } catch (error) {
      this.logger.warn(
        `JWT validation failed: ${(error as Error).message ?? 'unknown'}`,
      );
      throw new UnauthorizedException('Invalid token');
    }
  }
}
