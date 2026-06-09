import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Audit module.
 *
 * Suite tenancy (Phase 2, B8): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every read through. PrismaService + ConfigService resolve from
 * their global modules. Inert while PROJECT_OPS_TENANCY_ENABLED is off.
 */
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [AuditService],
})
export class AuditModule {}
