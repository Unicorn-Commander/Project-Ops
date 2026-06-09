import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Suite tenancy (Phase 2, B7): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every aggregate query through. Inert while
 * PROJECT_OPS_TENANCY_ENABLED is off.
 */
@Module({
  imports: [PrismaModule, ProjectsModule, UsersModule],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
})
export class DashboardModule {}
