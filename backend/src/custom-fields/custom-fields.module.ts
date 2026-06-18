import { Module } from '@nestjs/common';
import { CustomFieldsService } from './custom-fields.service';
import { CustomFieldsController } from './custom-fields.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Custom fields: workspace-defined attributes on tasks / projects.
 *
 * Exports CustomFieldsService so the tasks + projects modules can import this
 * module and call `validateValues` to coerce/validate custom-field VALUES on
 * entity create/update (storing the result under `metadata.customFields`).
 *
 * Suite tenancy (Phase 2): WorkspaceContextService + MembershipService are NOT
 * @Global, so this module lists them (and the WorkspaceMembershipGuard) in its
 * own providers — they drive the per-request workspace RLS chokepoint the
 * CustomFieldsService runs every query through. Inert while
 * PROJECT_OPS_TENANCY_ENABLED is off. Mirrors SavedViewsModule.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [CustomFieldsController],
  providers: [
    CustomFieldsService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [CustomFieldsService],
})
export class CustomFieldsModule {}
