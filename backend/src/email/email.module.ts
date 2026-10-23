import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailOpsModule } from '../email-ops/email-ops.module';

@Module({
  imports: [PrismaModule, EmailOpsModule],
  controllers: [EmailController],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
