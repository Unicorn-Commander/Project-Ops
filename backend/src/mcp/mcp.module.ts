import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { TriageModule } from '../triage/triage.module';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module';
// Wave 2 feature modules — each `exports:` the service the MCP tools delegate
// to, so importing the module makes the service injectable into McpService.
// The MCP tools call these exact services (not re-implementations) so agents
// run the SAME RBAC + workspace-RLS chokepoint the REST controllers do.
import { ReportingModule } from '../reporting/reporting.module';
import { CapacityModule } from '../capacity/capacity.module';
import { AutomationsModule } from '../automations/automations.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ClientPortalModule } from '../client-portal/client-portal.module';
// AgentsModule exports AgentEventsService — McpService injects it @Optional()
// to record each successful tool call as an agent activity event (via=MCP).
import { AgentsModule } from '../agents/agents.module';
// WorkspacesModule exports WorkspacesService — the member-management spine the
// member tools (invite / role / remove / list) delegate to.
import { WorkspacesModule } from '../workspaces/workspaces.module';

@Module({
  imports: [
    PrismaModule,
    DocumentsModule,
    TriageModule,
    TimeTrackingModule,
    ReportingModule,
    CapacityModule,
    AutomationsModule,
    CustomFieldsModule,
    // ClientPortalModule exports ApprovalsService (the staff `request` +
    // `listForProject` spine the approval tools wrap).
    ClientPortalModule,
    AgentsModule,
    WorkspacesModule,
  ],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
