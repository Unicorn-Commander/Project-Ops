import { ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ModuleRef, Reflector } from '@nestjs/core';
import { Request } from 'express';
import { isPatToken } from '../pat/pat.util';
import { PatService } from '../pat/pat.service';

/**
 * Auth chokepoint for every protected route.
 *
 * Behavior:
 *   1. Routes flagged `@Public()` (isPublic reflector key) skip auth.
 *   2. If the bearer token starts with `po_pat_` we resolve it via
 *      PatService — bcrypt-compare against active token hashes, bump
 *      lastUsedAt on hit, attach the User AND the matched PAT row to
 *      the request, and return true. A PAT-shaped value that doesn't
 *      resolve is a hard 401 (we never fall through to JWT parsing
 *      because a PAT can never be a valid JWT).
 *   3. Otherwise we delegate to Passport's JWT strategy, which keeps
 *      the three existing JWT branches working unchanged (local HS256
 *      session token, Keycloak realm RS256, and the Brigade federation
 *      RS256/EdDSA path when activated).
 *
 * Because this is the SAME guard every controller already references
 * (`@UseGuards(JwtAuthGuard)`), PAT support drops in across the whole
 * codebase with zero per-route decorator changes.
 *
 * PatService is resolved lazily via ModuleRef so this guard doesn't
 * introduce a constructor coupling that breaks DI ordering in modules
 * that already imported AuthModule via `forwardRef`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private patService?: PatService;

  constructor(
    private reflector: Reflector,
    private moduleRef: ModuleRef,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (token && isPatToken(token)) {
      const pats = await this.resolvePatService();
      const resolved = await pats.findByPlaintext(token);
      if (!resolved) {
        throw new UnauthorizedException('Invalid token');
      }
      (request as any).user = resolved.user;
      (request as any).pat = resolved.token;
      return true;
    }

    const result = await super.canActivate(context);
    return result instanceof Promise ? await result : (result as boolean);
  }

  private async resolvePatService(): Promise<PatService> {
    if (!this.patService) {
      // strict:false because PatService lives in the same module as
      // this guard; without it ModuleRef can't find providers from
      // outside its declaring module context.
      this.patService = this.moduleRef.get(PatService, { strict: false });
    }
    return this.patService;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.headers?.authorization ?? (request.headers as any)?.Authorization;
  if (typeof header !== 'string') return null;
  const [scheme, value] = header.split(/\s+/, 2);
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
}
