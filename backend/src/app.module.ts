import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

// Core modules
import { PrismaModule } from './prisma/prisma.module';
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
import { OrganizationsModule } from './organizations/organizations.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate limiting - Global: 10 requests per 60 seconds
    // Named throttlers for different security levels
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 60000, // 60 seconds in milliseconds
        limit: 10,  // 10 requests per ttl window
      },
      {
        name: 'long',
        ttl: 3600000, // 1 hour
        limit: 100,
      },
    ]),

    // Event emitter for internal events
    EventEmitterModule.forRoot(),

    // Scheduled tasks
    ScheduleModule.forRoot(),

    // Core modules
    PrismaModule,
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
    OrganizationsModule,
  ],
  providers: [
    // Enable rate limiting globally via guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}