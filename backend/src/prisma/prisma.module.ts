import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { DbRoleGuardService } from './db-role-guard.service';

@Global()
@Module({
  // DbRoleGuardService is a boot-time self-check (item 2): it has no exported
  // surface, it just runs onModuleInit to verify the live DB role can enforce
  // RLS (and fail-closed when tenancy is enabled).
  providers: [PrismaService, DbRoleGuardService],
  exports: [PrismaService],
})
export class PrismaModule {}
