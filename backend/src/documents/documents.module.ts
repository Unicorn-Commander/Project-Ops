import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { MinioService } from './minio.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ConfigModule, AuditModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, MinioService],
  exports: [DocumentsService, MinioService],
})
export class DocumentsModule {}