import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import { PrismaModule } from '../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { TriageModule } from '../triage/triage.module';

@Module({
  imports: [PrismaModule, DocumentsModule, TriageModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
