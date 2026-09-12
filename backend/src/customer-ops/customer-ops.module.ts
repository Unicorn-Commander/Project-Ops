import { Module } from '@nestjs/common';
import { CUSTOMER_OPS_PORT } from './customer-ops.port';
import { HttpCustomerOpsClient } from './http-customer-ops.client';
import { QuotePanelService } from './quote-panel.service';

/**
 * Customer-Ops federation client (Quotes & Proposals seam, QUOTES-CONTRACT-v1
 * §3). Read-through only: Project-Ops never copies a quote. Inert when
 * CUSTOMER_OPS_BASE_URL / CUSTOMER_OPS_SERVICE_TOKEN are unset — the panel
 * degrades to the cached summary with a "connect Customer-Ops" note.
 * ConfigService comes from the global ConfigModule.
 */
@Module({
  providers: [{ provide: CUSTOMER_OPS_PORT, useClass: HttpCustomerOpsClient }, QuotePanelService],
  exports: [CUSTOMER_OPS_PORT, QuotePanelService],
})
export class CustomerOpsModule {}
