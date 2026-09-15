import { Module } from '@nestjs/common';
import { EMAIL_OPS_PORT } from './email-ops.port';
import { HttpEmailOpsClient } from './http-email-ops.client';

/**
 * Email-Ops federation client (outbound mail, the "professional mail goes
 * through Email-Ops" house rule). Inert when EMAIL_OPS_BASE_URL /
 * EMAIL_OPS_SERVICE_TOKEN are unset — callers keep their today-SMTP behaviour.
 * ConfigService comes from the global ConfigModule.
 */
@Module({
  providers: [{ provide: EMAIL_OPS_PORT, useClass: HttpEmailOpsClient }],
  exports: [EMAIL_OPS_PORT],
})
export class EmailOpsModule {}
