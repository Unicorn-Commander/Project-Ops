import { Module } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { ProjectsRecurrenceService } from './projects-recurrence.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { CUSTOM_FIELDS_SERVICE } from './custom-fields.contract';

/**
 * Suite tenancy (Phase 2, B1): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every query through. Inert while PROJECT_OPS_TENANCY_ENABLED is
 * off.
 */
@Module({
  imports: [PrismaModule, AuditModule, CustomFieldsModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectsRecurrenceService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
    { provide: CUSTOM_FIELDS_SERVICE, useExisting: CustomFieldsService },
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
