import { ProjectsModule } from '../projects/projects.module';
import { ClientPortalModule } from '../client-portal/client-portal.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule, ProjectsModule, ClientPortalModule, PrismaModule],
  providers: [RealtimeGateway, WorkspaceContextService, MembershipService],
  exports: [RealtimeGateway],
})
export class WebSocketModule {}
