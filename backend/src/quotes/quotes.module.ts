import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FederationActorGuard } from '../common/workspace/federation-actor.guard';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { CustomerOpsModule } from '../customer-ops/customer-ops.module';
import { DocumentsModule } from '../documents/documents.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ProjectsModule } from '../projects/projects.module';
import { QuotePanelController } from './quote-panel.controller';
import { QuotesFederationController } from './quotes-federation.controller';
import { QuotesFederationService } from './quotes-federation.service';

/**
 * Quotes & Proposals — the Project-Ops execution seam (QUOTES-CONTRACT-v1 §3).
 *
 *   POST /federation/quotes/accepted  — Customer-Ops federates an acceptance
 *   GET  /projects/:id/quote          — the staff Quote panel (read-through)
 *
 * ProjectsModule exports ProjectsService (project numbering + findOne),
 * DocumentsModule exports MinioService (the accepted PDF), AuditModule exports
 * AuditService, CustomerOpsModule exports the read-through port + panel
 * builder. WorkspaceContextService / MembershipService / the guards are not
 * @Global, so they are listed here like every other feature module.
 */
@Module({
  imports: [PrismaModule, AuditModule, ProjectsModule, DocumentsModule, CustomerOpsModule],
  controllers: [QuotesFederationController, QuotePanelController],
  providers: [
    QuotesFederationService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
    FederationActorGuard,
  ],
  exports: [QuotesFederationService],
})
export class QuotesModule {}
