import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationsController } from './organizations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Suite tenancy (Phase 2, B5): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every query through. Inert while PROJECT_OPS_TENANCY_ENABLED is
 * off.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
