import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhooksListener } from './webhooks.listener';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Outbound webhooks — endpoint CRUD + event-driven signed delivery.
 *
 * Suite tenancy: WorkspaceContextService + MembershipService are NOT @Global, so
 * (matching NotificationsModule / CommentsModule) this module lists them — plus
 * the WorkspaceMembershipGuard named in the controller's @UseGuards — in its own
 * providers. They drive the per-request workspace RLS chokepoint every query
 * runs through.
 *
 * WebhooksListener subscribes to the tasks/projects domain events via @OnEvent;
 * it just needs to be a registered provider for @nestjs/event-emitter to
 * discover its handlers. (EventEmitterModule is configured app-wide.)
 *
 * WebhooksService is exported so other modules could, if needed, look up
 * subscribers / trigger deliveries directly.
 */
@Module({
  imports: [PrismaModule],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookDeliveryService,
    WebhooksListener,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
