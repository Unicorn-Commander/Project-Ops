import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BillableRollupService } from './billable-rollup.service';
import { ACCOUNTING_OPS_PORT, AccountingOpsPort } from './accounting-ops.port';

/**
 * Accounting-Ops exposes no webhooks, so invoice status (sent/partial/paid/
 * overdue) is pulled on a schedule and mirrored onto the Project billing
 * fields. Requires a service bearer (ACCOUNTING_OPS_SERVICE_TOKEN) that is a
 * member of the AO workspace with >= viewer. Users can also force a sync on
 * demand via the REST/MCP trigger using their own token.
 */
@Injectable()
export class InvoiceStatusPoller {
  private readonly logger = new Logger(InvoiceStatusPoller.name);

  constructor(
    private readonly rollup: BillableRollupService,
    private readonly config: ConfigService,
    @Inject(ACCOUNTING_OPS_PORT) private readonly ao: AccountingOpsPort,
  ) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async poll(): Promise<void> {
    if (!this.ao.isLive()) return;
    const token = this.config.get<string>('ACCOUNTING_OPS_SERVICE_TOKEN');
    if (!token) {
      this.logger.debug('Invoice status poll skipped: ACCOUNTING_OPS_SERVICE_TOKEN not set');
      return;
    }
    try {
      const { synced } = await this.rollup.syncInvoiceStatuses(token);
      if (synced) this.logger.log(`Invoice status poll mirrored ${synced} invoice(s)`);
    } catch (err) {
      this.logger.warn(`Invoice status poll failed: ${(err as Error).message}`);
    }
  }
}
