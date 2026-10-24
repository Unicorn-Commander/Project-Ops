import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailController } from './email.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EmailOpsModule } from '../email-ops/email-ops.module';
import { InstanceOperatorGuard } from '../common/guards/instance-operator.guard';

/**
 * InstanceOperatorGuard is listed here (it is not @Global) because
 * EmailController applies it at class level to keep the shared, un-tenanted
 * SMTP relay config reachable only by the instance operator's workspace.
 */
@Module({
  imports: [PrismaModule, EmailOpsModule],
  controllers: [EmailController],
  providers: [EmailService, InstanceOperatorGuard],
  exports: [EmailService],
})
export class EmailModule {}
