import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { isPatToken } from '../pat/pat.util';

/** Runs after JwtAuthGuard: API credentials cannot manage API credentials. */
@Injectable()
export class PatManagementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const header = request?.headers?.authorization ?? request?.headers?.Authorization;
    const match = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header.trim()) : null;
    // Check both the authenticated marker and raw credential. The global JWT
    // guard's cached-user shortcut must never turn PAT auth into session auth.
    if (request?.pat || (match && isPatToken(match[1]))) {
      throw new ForbiddenException('A signed-in session is required to manage API tokens.');
    }
    if (!request?.user) {
      throw new UnauthorizedException('Authentication required.');
    }
    return true;
  }
}
