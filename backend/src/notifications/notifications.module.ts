import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsListener } from './notifications.listener';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Notifications + @mention fan-out (Collaboration / Push B).
 *
 * Suite tenancy: WorkspaceContextService + MembershipService are NOT @Global,
 * so (matching CommentsModule) this module lists them — plus the
 * WorkspaceMembershipGuard it names in the controller's @UseGuards — in its own
 * providers. They drive the per-request workspace RLS chokepoint the
 * NotificationsService runs every query through.
 *
 * NotificationsListener subscribes to the tasks module's `task.comment.created`
 * (and optional `task.assigned`) events via @OnEvent; it just needs to be a
 * registered provider for @nestjs/event-emitter to discover its handlers.
 *
 * NotificationsService is exported so other modules (e.g. CommentsService) can
 * inject it to fan out mentions directly.
 */
@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsListener,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
