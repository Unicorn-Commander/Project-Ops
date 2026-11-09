import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { InternalApprovalsController } from './internal-approvals.controller';
import { InternalApprovalsService } from './internal-approvals.service';

@Module({
  imports: [PrismaModule],
  controllers: [InternalApprovalsController],
  providers: [
    InternalApprovalsService,
    MembershipService,
    WorkspaceContextService,
    WorkspaceMembershipGuard,
  ],
  exports: [InternalApprovalsService],
})
export class InternalApprovalsModule {}
