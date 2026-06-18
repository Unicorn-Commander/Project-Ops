import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { TasksRecurrenceService } from './tasks-recurrence.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { CUSTOM_FIELDS_SERVICE } from './custom-fields.contract';

/**
 * Suite tenancy (Phase 2, B2): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every query through. Inert while PROJECT_OPS_TENANCY_ENABLED is
 * off.
 *
 * WAVE 2: TasksRecurrenceService hosts the daily @Cron that materializes
 * recurring-task instances (ScheduleModule.forRoot() is registered globally in
 * AppModule, so the @Cron is discovered here without extra wiring).
 *
 * The CustomFieldsService is consumed by TasksService through the
 * CUSTOM_FIELDS_SERVICE token (@Optional) — the integrator binds the real
 * provider when the CustomFieldsModule is wired into this module's imports; see
 * ./custom-fields.contract.ts.
 */
@Module({
  imports: [PrismaModule, EmailModule, CustomFieldsModule],
  controllers: [TasksController],
  providers: [
    TasksService,
    TasksRecurrenceService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
    { provide: CUSTOM_FIELDS_SERVICE, useExisting: CustomFieldsService },
  ],
  exports: [TasksService],
})
export class TasksModule {}
