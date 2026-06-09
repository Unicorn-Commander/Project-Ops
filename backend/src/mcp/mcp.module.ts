import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { TriageModule } from '../triage/triage.module';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module';

@Module({
  imports: [PrismaModule, DocumentsModule, TriageModule, TimeTrackingModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
