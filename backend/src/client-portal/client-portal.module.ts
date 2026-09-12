import { Module } from '@nestjs/common';
import { ClientPortalController } from './client-portal.controller';
import { ClientPortalService } from './client-portal.service';
import { ApprovalsService } from './approvals/approvals.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { CustomerOpsModule } from '../customer-ops/customer-ops.module';

/**
 * Suite tenancy (Phase 2, G3): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * services run every query through. ConfigService comes from the global
 * ConfigModule; PrismaService from PrismaModule; EventEmitter2 from the global
 * EventEmitterModule.forRoot(); AuditService from AuditModule (it re-exports it).
 *
 * RolesGuard is referenced in the controller's @UseGuards but is NOT listed
 * here: it only depends on the globally-available Reflector, so Nest constructs
 * it per-controller without a provider (same as ProjectsModule/CommentsModule).
 *
 * ApprovalsService is exported so a staff surface in another module can call
 * `ApprovalsService.request(...)` to raise a client approval without the portal
 * HTTP route. Inert while PROJECT_OPS_TENANCY_ENABLED is off.
 */
@Module({
  // CustomerOpsModule exports QuotePanelService — the portal's Quote panel
  // (QUOTES-CONTRACT-v1 §3) reads through to Customer-Ops with the CLIENT mask.
  imports: [PrismaModule, AuditModule, CustomerOpsModule],
  controllers: [ClientPortalController],
  providers: [
    ClientPortalService,
    ApprovalsService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [ClientPortalService, ApprovalsService],
})
export class ClientPortalModule {}
