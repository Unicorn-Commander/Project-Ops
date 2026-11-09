import { Module } from '@nestjs/common';
import { TriageService } from './triage.service';
import { TriageController } from './triage.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { FederationActorGuard } from '../common/workspace/federation-actor.guard';
import { ORG_GATEWAY_KEY_PROVIDER, OpsCenterOrgGatewayKeyProvider } from './org-gateway.client';

/**
 * Project-Ops Triage Agent module (PO-owned).
 *
 * Depends on ProjectsModule + TasksModule for the apply step (create project /
 * create task on approval) and PrismaModule for the TriageProposal store.
 * ConfigService comes from the global ConfigModule. Inference endpoints
 * (Infinity + Qwen) are reached over the LAN via env (see triage.service).
 *
 * Suite tenancy (Phase 2, B9): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every query through. Inert while PROJECT_OPS_TENANCY_ENABLED is
 * off.
 */
@Module({
  imports: [PrismaModule, ProjectsModule, TasksModule],
  controllers: [TriageController],
  providers: [
    TriageService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
    FederationActorGuard,
    {
      provide: ORG_GATEWAY_KEY_PROVIDER,
      useClass: OpsCenterOrgGatewayKeyProvider,
    },
  ],
  exports: [TriageService],
})
export class TriageModule {}
