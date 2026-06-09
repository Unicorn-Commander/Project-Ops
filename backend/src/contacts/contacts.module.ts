import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Suite tenancy (Phase 2, B6): WorkspaceContextService + MembershipService are
 * NOT @Global, so this module lists them (and the WorkspaceMembershipGuard) in
 * its own providers. They drive the per-request workspace RLS chokepoint the
 * service runs every query through. Inert while PROJECT_OPS_TENANCY_ENABLED is
 * off.
 */
@Module({
  imports: [PrismaModule, EmailModule, AuditModule],
  controllers: [ContactsController],
  providers: [
    ContactsService,
    WorkspaceContextService,
    MembershipService,
    WorkspaceMembershipGuard,
  ],
  exports: [ContactsService],
})
export class ContactsModule {}
