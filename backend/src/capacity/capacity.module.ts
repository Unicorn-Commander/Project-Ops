import { Module } from '@nestjs/common';
import { CapacityService } from './capacity.service';
import { CapacityController } from './capacity.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Capacity / resource planning (Wave 2).
 *
 * Suite tenancy (mirrors TasksModule): WorkspaceContextService +
 * MembershipService are NOT @Global, so this module lists them (and the
 * WorkspaceMembershipGuard) in its own providers. They drive the per-request
 * workspace RLS chokepoint the service runs every task aggregation through.
 * Inert while PROJECT_OPS_TENANCY_ENABLED is off.
 *
 * The integrator registers CapacityModule in AppModule.
 */
@Module({
  imports: [PrismaModule],
  controllers: [CapacityController],
  providers: [
    CapacityService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [CapacityService],
})
export class CapacityModule {}
