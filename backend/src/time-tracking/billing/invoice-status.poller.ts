import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { BillableRollupService } from './billable-rollup.service';
import { ACCOUNTING_OPS_PORT, AccountingOpsPort } from './accounting-ops.port';

/**
 * Accounting-Ops exposes no webhooks, so invoice status (sent/partial/paid/
 * overdue) is pulled on a schedule and mirrored onto the Project billing
 * fields. Requires a service bearer (ACCOUNTING_OPS_SERVICE_TOKEN) that is a
 * member of the AO workspace with >= viewer. Users can also force a sync on
 * demand via the REST/MCP trigger using their own token.
 *
 * SUITE TENANCY (§6): the cron runs with NO request user, and under live RLS a
 * cross-workspace scan is illegal. So the poller iterates active Workspace rows
 * (the `workspaces` control-plane table is NOT under RLS — reading it directly
 * via PrismaService is correct) and runs ONE workspace-scoped sync per tenant,
 * each fenced inside its own RLS tx by BillableRollupService.syncInvoiceStatuses.
 */
@Injectable()
export class InvoiceStatusPoller {
  private readonly logger = new Logger(InvoiceStatusPoller.name);

  constructor(
    private readonly rollup: BillableRollupService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
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

    // Control-plane read (not RLS-scoped): every active tenant workspace.
    const workspaces = await this.prisma.workspace.findMany({
      where: { status: 'active' },
      select: { id: true },
    });

    let total = 0;
    for (const ws of workspaces) {
      try {
        const { synced } = await this.rollup.syncInvoiceStatuses(token, { workspaceId: ws.id });
        total += synced;
      } catch (err) {
        this.logger.warn(`Invoice status poll failed for ws=${ws.id}: ${(err as Error).message}`);
      }
    }
    if (total)
      this.logger.log(
        `Invoice status poll mirrored ${total} invoice(s) across ${workspaces.length} workspace(s)`,
      );
  }
}
