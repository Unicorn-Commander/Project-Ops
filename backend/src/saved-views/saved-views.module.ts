import { Module } from '@nestjs/common';
import { SavedViewsService } from './saved-views.service';
import { SavedViewsController } from './saved-views.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Suite tenancy (Phase 2): WorkspaceContextService + MembershipService are NOT
 * @Global, so this module lists them (and the WorkspaceMembershipGuard) in its
 * own providers. They drive the per-request workspace RLS chokepoint the
 * SavedViewsService runs every query through. Inert while
 * PROJECT_OPS_TENANCY_ENABLED is off.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [SavedViewsController],
  providers: [
    SavedViewsService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [SavedViewsService],
})
export class SavedViewsModule {}
