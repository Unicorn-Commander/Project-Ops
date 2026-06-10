import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    // A trusted federation actor (confirmed + allow-listed by
    // FederationActorGuard, which set req.federationActor) has no human
    // UserRole; its authorization is the actor allow-list + route scope, a
    // stronger gate than a coarse role. Humans never have req.federationActor
    // set, so the human role check below is untouched.
    if (req.federationActor) {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = req;
    return requiredRoles.some((role) => user.role === role);
  }
}