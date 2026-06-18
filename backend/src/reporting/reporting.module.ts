import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';
import { ReportingController } from './reporting.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Reporting (Wave 2): portfolio health, profitability, and throughput.
 *
 * Suite tenancy: like the projects/time-tracking modules, WorkspaceContextService
 * + MembershipService are NOT @Global, so this module lists them (and the
 * WorkspaceMembershipGuard) in its own providers — they drive the per-request
 * workspace RLS chokepoint the service runs every query through. Reuses the
 * time-tracking money model (stored billableAmount) rather than reimplementing
 * rate math. Import this module in AppModule to expose the /reporting routes.
 */
@Module({
  imports: [PrismaModule],
  controllers: [ReportingController],
  providers: [
    ReportingService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [ReportingService],
})
export class ReportingModule {}
