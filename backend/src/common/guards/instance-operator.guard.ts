import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_WORKSPACE_FALLBACK } from '../workspace/workspace.util';

/**
 * Restricts a route to the INSTANCE OPERATOR workspace.
 *
 * Some resources in this deployment are genuinely instance-level infrastructure
 * rather than tenant data — the shared SMTP relay configuration (`email_config`)
 * is the motivating case. That table is a single un-tenanted row: it has no
 * workspaceId column, no RLS policy, and `saveConfig()` deletes every existing
 * row before writing. Gating those routes on the global `UserRole.ADMIN` enum
 * alone is therefore insufficient: `ADMIN` has no workspace dimension, so any
 * tenant's admin could overwrite or delete the deployment's shared mail
 * credentials — and then send mail through the relay under our domain.
 *
 * Until `email_config` is given a workspaceId + RLS (the proper multi-tenant
 * fix, which requires a migration and a per-tenant SMTP UX), this guard keeps
 * the surface reachable ONLY by an admin acting inside the operator workspace
 * (DEFAULT_WORKSPACE_ID). Every other tenant gets 403 — they cannot read the
 * config, cannot destroy it, and cannot relay through it.
 *
 * Must be combined with JwtAuthGuard + RolesGuard; it checks the workspace
 * dimension only, and relies on the globally-registered WorkspaceMembershipGuard
 * having already resolved and authorized `req.workspaceId`.
 */
@Injectable()
export class InstanceOperatorGuard implements CanActivate {
  private readonly logger = new Logger(InstanceOperatorGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest();
    const operatorWorkspaceId = this.config.get<string>(
      'DEFAULT_WORKSPACE_ID',
      DEFAULT_WORKSPACE_FALLBACK,
    );
    const callerWorkspaceId: string | undefined = req?.workspaceId;

    if (!callerWorkspaceId || callerWorkspaceId !== operatorWorkspaceId) {
      this.logger.warn(
        `Blocked instance-operator route for workspace=${callerWorkspaceId ?? 'none'} ` +
          `user=${req?.user?.email ?? 'unknown'} path=${req?.originalUrl ?? req?.url}`,
      );
      throw new ForbiddenException('This resource is managed by the instance operator.');
    }
    return true;
  }
}
