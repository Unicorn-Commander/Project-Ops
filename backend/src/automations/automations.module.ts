import { Module } from '@nestjs/common';
import { AutomationsService } from './automations.service';
import { AutomationsController } from './automations.controller';
import { AutomationsListener } from './automations.listener';
import { AutomationContext } from './automation-context';
import { PrismaModule } from '../prisma/prisma.module';
import { TasksModule } from '../tasks/tasks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Automations / rules engine.
 *
 * Imports TasksModule + NotificationsModule for their exported services
 * (TasksService / NotificationsService) — the engine executes rule actions
 * through those real services so each action inherits their validation,
 * authorization and workspace RLS. Both modules `exports:` their service, so
 * the imports resolve.
 *
 * Suite tenancy: WorkspaceContextService + MembershipService are NOT @Global, so
 * (matching Tasks/Notifications modules) this module lists them plus the
 * WorkspaceMembershipGuard named in the controller's @UseGuards.
 *
 * AutomationsListener subscribes to the tasks/projects/comment domain events via
 * @OnEvent; it only needs to be a registered provider for @nestjs/event-emitter
 * to discover its handlers (EventEmitterModule is registered app-wide).
 *
 * AutomationsService is exported in case other modules want to trigger the
 * engine programmatically.
 */
@Module({
  imports: [PrismaModule, TasksModule, NotificationsModule],
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    AutomationsListener,
    AutomationContext,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [AutomationsService],
})
export class AutomationsModule {}
