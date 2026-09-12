import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

import { validateEnv } from './config/env.validation';
import { THROTTLER_TIERS } from './config/throttler.config';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { WorkspaceMembershipGuard } from './common/workspace/workspace-membership.guard';
import { MembershipService } from './common/workspace/membership.service';

// Core modules
import { PrismaModule } from './prisma/prisma.module';
import { RegistryModule } from './common/registry/registry.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { ContactsModule } from './contacts/contacts.module';
import { ClientPortalModule } from './client-portal/client-portal.module';
import { DocumentsModule } from './documents/documents.module';
import { CommentsModule } from './comments/comments.module';
import { AuditModule } from './audit/audit.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { WebSocketModule } from './websocket/websocket.module';
import { EmailModule } from './email/email.module';
import { TasksModule } from './tasks/tasks.module';
import { TriageModule } from './triage/triage.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { McpModule } from './mcp/mcp.module';
import { AssistantModule } from './assistant/assistant.module';
import { TimeTrackingModule } from './time-tracking/time-tracking.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SavedViewsModule } from './saved-views/saved-views.module';
// Wave 2 modules
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { AutomationsModule } from './automations/automations.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { CapacityModule } from './capacity/capacity.module';
import { ReportingModule } from './reporting/reporting.module';
import { AgentsModule } from './agents/agents.module';
// Quotes & Proposals seam (QUOTES-CONTRACT-v1 §3): Customer-Ops → Project-Ops
// federation ingress + the Quote panel (read-through, degrade-clean).
import { QuotesModule } from './quotes/quotes.module';

@Module({
  imports: [
    // Configuration. `validate` runs once at boot and aborts startup on a
    // missing/weak required var (item 3: JWT_SECRET + EMAIL_ENCRYPTION_KEY are
    // fail-closed in production). See src/config/env.validation.ts.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate: validateEnv,
    }),

    // Rate limiting — sane named tiers (short/long human default + a present-
    // but-looser `mcp` tier for the agent surface). See config/throttler.config.ts
    // for the policy rationale. Per-route @Throttle overrides (auth/login, etc.)
    // keep tightening the `short` tier where it matters.
    ThrottlerModule.forRoot(THROTTLER_TIERS),

    // Event emitter for internal events
    EventEmitterModule.forRoot(),

    // Scheduled tasks
    ScheduleModule.forRoot(),

    // Core modules
    PrismaModule,
    // uc-registry client (Phase E). @Global, inert while UC_REGISTRY_URL unset.
    RegistryModule,
    AuthModule,
    UsersModule,
    ProjectsModule,
    ContactsModule,
    ClientPortalModule,
    DocumentsModule,
    CommentsModule,
    AuditModule,
    DashboardModule,
    HealthModule,
    WebSocketModule,
    EmailModule,
    TasksModule,
    TriageModule,
    OrganizationsModule,
    McpModule,
    AssistantModule,
    TimeTrackingModule,
    WorkspacesModule,
    NotificationsModule,
    SavedViewsModule,
    CustomFieldsModule,
    AutomationsModule,
    WebhooksModule,
    CapacityModule,
    ReportingModule,
    AgentsModule,
    QuotesModule,
  ],
  providers: [
    // MembershipService is needed to construct the GLOBAL WorkspaceMembershipGuard
    // in this module's injection context. It is otherwise a per-feature-module
    // provider (PrismaService + ConfigService are both @Global, so this resolves
    // cleanly). Inert while PROJECT_OPS_TENANCY_ENABLED is off.
    MembershipService,

    // Global guard chain. Order matters: NestJS runs global guards in
    // declaration order, BEFORE any controller/route guard
    // (`globalGuards.concat(scopedGuards)`).
    //
    //   1. ThrottlerGuard            — cheapest gate first; reject floods before
    //                                  we touch auth/DB.
    //   2. JwtAuthGuard              — authenticate by default. Routes opt out
    //                                  with @Public() (login, SSO, signup,
    //                                  health, version). Populates req.user so
    //                                  the membership guard below can resolve.
    //   3. WorkspaceMembershipGuard  — membership-gate by default so a new
    //                                  controller can't silently skip the 403.
    //                                  Routes opt out with @SkipWorkspaceMembership().
    //                                  Inert (never throws) while tenancy is OFF.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: WorkspaceMembershipGuard,
    },
  ],
})
export class AppModule {}
