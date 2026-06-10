import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WithWorkspaceClaim } from './workspace.util';

/**
 * Trusted sibling-app FEDERATION ingress (SUITE-IDENTITY federation model).
 *
 * The rest of the suite federates app→app via a Brigade token-exchange: a
 * trusted sibling app presents a Brigade-minted token bound to THIS app's
 * audience and carrying a `workspace_id`, and the receiver trusts that
 * Brigade-vouched tenant context. This guard is Project-Ops's inbound side of
 * that model, scoped as NARROWLY as possible:
 *
 *   - It only elevates a SYNTHETIC federation principal (JwtStrategy →
 *     AuthService.buildFederationPrincipal: `__isFederationActor === true`,
 *     created ONLY for a Brigade-issued, aud=project-ops token whose
 *     `act.client_id` is the calling app). A human token never sets this.
 *   - The calling app (`__federationActor`) must be on the explicit allow-list
 *     `PROJECT_OPS_FEDERATION_ACTORS` (CSV; DEFAULT EMPTY ⇒ zero federation
 *     trust — safe by default).
 *   - It only activates on designated FEDERATION_ROUTES (currently the
 *     propose-only `triage/ingest`). On any other handler a federation actor
 *     falls through to the normal guards (no req.federationActor) and is
 *     rejected (it has no human role / membership).
 *
 * When it elevates, it stamps `req.workspaceId` from the Brigade-vouched claim
 * and marks `req.federationActor`; RolesGuard + WorkspaceMembershipGuard then
 * short-circuit for that marker (their human paths are untouched). The
 * `workspace_id` claim only STEERS where the trusted actor writes — trust is
 * established by the Brigade signature + aud binding (already enforced in
 * JwtStrategy) + this actor allow-list, never by the claim itself.
 */
@Injectable()
export class FederationActorGuard implements CanActivate {
  private readonly logger = new Logger(FederationActorGuard.name);

  /** Handlers (by method name) that accept a trusted federation actor. */
  private static readonly FEDERATION_ROUTES = new Set<string>(['ingest']);

  constructor(private readonly config: ConfigService) {}

  private allowList(): Set<string> {
    const raw = this.config.get<string>('PROJECT_OPS_FEDERATION_ACTORS', '');
    return new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req?.user as WithWorkspaceClaim | undefined;
    // No authenticated principal: let the downstream guards own the rejection
    // (don't mask a 401/403 here). JwtAuthGuard runs before this guard.
    if (!user) return true;

    const handler = context.getHandler()?.name;
    const isFederationRoute =
      !!handler && FederationActorGuard.FEDERATION_ROUTES.has(handler);

    if (
      isFederationRoute &&
      user.__isFederationActor === true &&
      typeof user.__federationActor === 'string' &&
      user.__workspaceClaim &&
      user.__workspaceClaim.trim()
    ) {
      const allow = this.allowList();
      if (allow.has(user.__federationActor)) {
        // Brigade signature + aud=project-ops were already enforced by
        // JwtStrategy (a synthetic federation principal is created ONLY for
        // such a token). The actor allow-list is the remaining gate.
        req.workspaceId = user.__workspaceClaim.trim();
        req.federationActor = user.__federationActor;
        this.logger.log(
          `federation ingest: actor=${user.__federationActor} ws=${req.workspaceId} handler=${handler}`,
        );
        return true;
      }
      this.logger.warn(
        `federation actor '${user.__federationActor}' is NOT allow-listed (PROJECT_OPS_FEDERATION_ACTORS); falling through to membership path`,
      );
    }

    // Not a trusted federation actor on a federation route: fall through.
    // req.federationActor stays unset → RolesGuard + WorkspaceMembershipGuard
    // apply the normal human path (D5 unchanged). A synthetic federation
    // principal that isn't allow-listed (or hits a non-federation route) has no
    // human role/membership and is correctly rejected there.
    return true;
  }
}
