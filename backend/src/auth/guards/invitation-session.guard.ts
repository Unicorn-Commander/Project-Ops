import { tenancyEnabled } from '../../common/workspace/feature-flags';
import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PatManagementGuard } from './pat-management.guard';

@Injectable()
export class InvitationSessionGuard extends PatManagementGuard {
  constructor(private readonly config: ConfigService) {
    super();
  }
  canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);
    if (!tenancyEnabled((key) => this.config.get<string>(key))) {
      throw new ForbiddenException('Workspace tenancy must be enabled for invitations.');
    }
    if (context.switchToHttp().getRequest().user?.__invitationSession !== true) {
      throw new ForbiddenException('A signed-in human session is required for invitations.');
    }
    return true;
  }
}
