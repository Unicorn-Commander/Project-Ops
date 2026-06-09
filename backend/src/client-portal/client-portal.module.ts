import { Module } from '@nestjs/common';
import { ClientPortalController } from './client-portal.controller';
import { ClientPortalService } from './client-portal.service';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Suite tenancy (Phase 2, G3): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every query through. ConfigService comes from the global
 * ConfigModule; PrismaService from PrismaModule. Inert while
 * PROJECT_OPS_TENANCY_ENABLED is off.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ClientPortalController],
  providers: [
    ClientPortalService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [ClientPortalService],
})
export class ClientPortalModule {}
