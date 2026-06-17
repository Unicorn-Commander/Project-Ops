import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Workspace & member management module ("easy sharing").
 *
 * MembershipService + WorkspaceMembershipGuard are NOT @Global, so this module
 * lists them. UcRegistryService comes from the @Global RegistryModule, and
 * AuditService from AuditModule (imported). PrismaService + ConfigService are
 * @Global. The service reads/writes the control-plane `workspaces` +
 * `memberships` tables directly (no RLS), so it does NOT need
 * WorkspaceContextService.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, MembershipService, WorkspaceMembershipGuard],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
