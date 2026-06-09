import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { MinioService } from './minio.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Suite tenancy (Phase 2, B4): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * DocumentsService runs every metadata query through. Inert while
 * PROJECT_OPS_TENANCY_ENABLED is off.
 */
@Module({
  imports: [ConfigModule, PrismaModule, AuditModule],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    MinioService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [DocumentsService, MinioService],
})
export class DocumentsModule {}
