import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { AgentEventsService } from './agent-events.service';
import { AgentsController } from './agents.controller';

/**
 * Agent activity & usage (v1.11): the agent analog of time-tracking. Captures an
 * AgentEvent per agent action (MCP tool call, assistant turn) and exposes the
 * roster / activity / usage-&-cost read surface.
 *
 * SUITE TENANCY: like reporting/capacity, WorkspaceContextService +
 * MembershipService are NOT @Global, so this module lists them (and the
 * WorkspaceMembershipGuard) in its own providers — they drive the per-request
 * workspace RLS chokepoint the service runs every query through.
 *
 * INTEGRATOR — to wire this up:
 *   1. Register `AgentsModule` in AppModule's `imports` (exposes the /agents routes).
 *   2. To enable CAPTURE from other modules, import `AgentsModule` into:
 *        - McpModule   (so McpService can inject AgentEventsService)
 *        - AssistantModule (so AssistantService can inject AgentEventsService)
 *      AgentEventsService is exported here; both call-sites inject it as an
 *      OPTIONAL dependency (`@Optional()`), so if a module is NOT yet wired the
 *      app still boots and simply skips capture for that surface — no crash.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AgentsController],
  providers: [
    AgentEventsService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [AgentEventsService],
})
export class AgentsModule {}
