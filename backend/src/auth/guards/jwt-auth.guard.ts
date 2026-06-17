import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ModuleRef, Reflector } from '@nestjs/core';
import { Request } from 'express';
import { isPatToken } from '../pat/pat.util';
import { PatService } from '../pat/pat.service';
import { explicitRequestedWorkspaceId } from '../../common/workspace/workspace.util';

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
 *
 *      WORKSPACE SCOPING (SUITE-IDENTITY §D4, blueprint C1): a PAT is
 *      bound to exactly one workspace. We resolve the request workspace
 *      with the SAME D4 precedence WorkspaceMembershipGuard uses — path
 *      param `workspaceId`/`workspace_id` > `X-Workspace-Id` header >
 *      the PAT's own `workspaceId` — and 403 if an explicit path/header
 *      target disagrees with the PAT's workspace (a PAT for W1 can never
 *      act on W2). On success we stamp the PAT's workspace as the
 *      request's `__workspaceClaim` + `req.workspaceId` so the GUC
 *      chokepoint (WorkspaceContextService.runForUser) and the MCP tool
 *      layer scope every query to the PAT's workspace, failing closed.
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
    // As a GLOBAL guard this also fires on non-HTTP execution contexts
    // (@SubscribeMessage WebSocket handlers). Those are authenticated at
    // connection time by RealtimeGateway.handleConnection (JWT in the socket
    // handshake), and `context.switchToHttp().getRequest()` is undefined for
    // them — so skip cleanly rather than misread an HTTP request. (Matches how
    // the built-in ThrottlerGuard short-circuits non-HTTP contexts.)
    if (context.getType() !== 'http') {
      return true;
    }

    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    // Idempotency: this guard is registered BOTH globally (APP_GUARD) and
    // per-route (@UseGuards on most controllers). The global pass runs first
    // and resolves the user; the per-route pass would otherwise re-validate the
    // bearer (and re-bcrypt a PAT). If we've already attached a user, accept.
    if ((request as any).user) {
      return true;
    }

    const token = extractBearerToken(request);

    if (token && isPatToken(token)) {
      const pats = await this.resolvePatService();
      const resolved = await pats.findByPlaintext(token);
      if (!resolved) {
        throw new UnauthorizedException('Invalid token');
      }

      // Enforce PAT workspace scoping (acceptance 9.6: a PAT for W1 cannot act
      // on W2). D4 precedence: an explicit path param / X-Workspace-Id header
      // is the addressed workspace; it MUST equal the PAT's bound workspace.
      // When the PAT carries no workspace (legacy token minted before scoping
      // landed) there is nothing to fence against — preserve prior behavior.
      const patWorkspaceId = resolved.workspaceId;
      if (patWorkspaceId) {
        const requested = explicitRequestedWorkspaceId(request);
        if (requested && requested !== patWorkspaceId) {
          this.logger.warn(
            `403 PAT workspace scope: token bound to ${patWorkspaceId} but request addressed ${requested} (user=${resolved.user.email})`,
          );
          throw new ForbiddenException('This token is not scoped to the requested workspace.');
        }
        // Make the PAT's workspace the request's effective claim so the GUC
        // chokepoint + @CurrentWorkspace resolve to it (a PAT has no JWT
        // claim of its own), and stash it where WorkspaceMembershipGuard
        // publishes the resolved workspace.
        (resolved.user as any).__workspaceClaim = patWorkspaceId;
        (request as any).workspaceId = patWorkspaceId;
      }

      (resolved.user as any).__ucUid = resolved.user.keycloakId ?? resolved.user.id;
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
