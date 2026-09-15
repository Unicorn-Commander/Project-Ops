import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WithWorkspaceClaim } from './workspace.util';
import {
  FEDERATION_ACTORS_ENV,
  FEDERATION_ACTOR_REQUIRED,
  parseFederationActors,
} from './federation-token';

/**
 * Trusted sibling-app FEDERATION ingress (SUITE-IDENTITY federation model).
 *
 * Write routes (quotes seam, Meeting-Ops triage ingest) are MACHINE-TOKEN
 * ONLY. A verified client-credentials / Brigade app-actor token whose
 * azp / client_id is on PROJECT_OPS_FEDERATION_ACTORS is elevated; a human
 * session, an unknown actor, or a missing workspace claim is 403
 * FEDERATION_ACTOR_REQUIRED — there is no human fall-through on these
 * handlers.
 *
 *   - Synthetic federation principal (JwtStrategy → AuthService:
 *     `__isFederationActor === true`), created ONLY for a machine token
 *     (no human session) whose actor id is azp / client_id / act.client_id.
 *   - The calling app must be on PROJECT_OPS_FEDERATION_ACTORS (CSV;
 *     DEFAULT EMPTY ⇒ zero federation trust).
 *   - Only designated FEDERATION_ROUTES. On any other handler a federation
 *     actor falls through (no req.federationActor) and is rejected by the
 *     human role/membership guards (it has no UserRole).
 *   - A route may NAME the actors it accepts. Quotes accept only
 *     `customer-ops`; ingest accepts any allow-listed actor (Meeting-Ops).
 *
 * When it elevates, it stamps `req.workspaceId` from the vouched claim and
 * marks `req.federationActor`. The claim only STEERS where the actor writes;
 * trust is the verified token + this allow-list, never the claim itself.
 */
@Injectable()
export class FederationActorGuard implements CanActivate {
  private readonly logger = new Logger(FederationActorGuard.name);

  /**
   * Handlers (by method name) that accept a trusted federation actor, mapped
   * to the actors permitted on each route. `null` = any allow-listed actor
   * (Meeting-Ops bridge `triage/ingest`). A named set narrows further.
   * Handler names must stay unique across controllers for this to be exact.
   */
  private static readonly FEDERATION_ROUTES = new Map<string, ReadonlySet<string> | null>([
    ['ingest', null],
    // Quotes & Proposals seam: POST federation/quotes/accepted. Only
    // Customer-Ops may federate a quote acceptance into a project.
    ['quoteAccepted', new Set(['customer-ops'])],
  ]);

  constructor(private readonly config: ConfigService) {}

  private allowList(): Set<string> {
    return parseFederationActors(this.config.get<string>(FEDERATION_ACTORS_ENV, ''));
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req?.user as WithWorkspaceClaim | undefined;
    // No authenticated principal: let JwtAuthGuard's 401 stand.
    if (!user) return true;

    const handler = context.getHandler()?.name;
    const isFederationRoute =
      !!handler && FederationActorGuard.FEDERATION_ROUTES.has(handler);

    if (!isFederationRoute) {
      // Non-federation handlers: never elevate. A synthetic principal has no
      // human role/membership and is rejected downstream.
      return true;
    }

    if (
      user.__isFederationActor === true &&
      typeof user.__federationActor === 'string' &&
      user.__workspaceClaim &&
      user.__workspaceClaim.trim()
    ) {
      const allow = this.allowList();
      const routeActors = FederationActorGuard.FEDERATION_ROUTES.get(handler) ?? null;
      const permittedOnRoute = routeActors === null || routeActors.has(user.__federationActor);
      if (allow.has(user.__federationActor) && permittedOnRoute) {
        req.workspaceId = user.__workspaceClaim.trim();
        req.federationActor = user.__federationActor;
        this.logger.log(
          `federation write: actor=${user.__federationActor} ws=${req.workspaceId} handler=${handler}`,
        );
        return true;
      }
      const why = allow.has(user.__federationActor)
        ? `federation actor '${user.__federationActor}' is allow-listed but NOT permitted on handler '${handler}'`
        : `federation actor '${user.__federationActor}' is NOT allow-listed (${FEDERATION_ACTORS_ENV})`;
      this.logger.warn(why);
      throw FederationActorGuard.actorRequired(why);
    }

    // Human session, unknown/unscoped actor, or missing workspace claim.
    this.logger.warn(
      `federation write refused on '${handler}': machine-token from an allow-listed actor required (no human session)`,
    );
    throw FederationActorGuard.actorRequired(
      'Federation write routes require a verified machine token from an allow-listed actor ' +
        `(${FEDERATION_ACTORS_ENV}); human sessions are rejected.`,
    );
  }

  private static actorRequired(reason: string): ForbiddenException {
    return new ForbiddenException({
      status: 'failed',
      code: FEDERATION_ACTOR_REQUIRED,
      reason,
    });
  }
}
