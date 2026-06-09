import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Suite tenancy (Phase 2, B1): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every query through. Inert while PROJECT_OPS_TENANCY_ENABLED is
 * off.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
