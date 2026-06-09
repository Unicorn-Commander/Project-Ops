import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';

import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { MembershipService } from '../common/workspace/membership.service';
import { TimeTrackingEnabledGuard } from '../common/workspace/time-tracking-enabled.guard';

import { RoundingService } from './rounding.service';
import { RateResolverService } from './rate-resolver.service';
import { EntryFinancialsService } from './entry-financials.service';
import { TimerService } from './timer.service';
import { TimeEntryService } from './time-entry.service';
import { BillingRateService } from './billing-rate.service';
import { TimesheetService } from './timesheet.service';
import { ReportsService } from './reports.service';

import { TimeEntriesController } from './time-entries.controller';
import { TimesheetsController } from './timesheets.controller';
import { BillingRatesController } from './billing-rates.controller';
import { ReportsController } from './reports.controller';

import { BillableDraftAssembler } from './billing/billable-draft.assembler';
import { InvoicePdfService } from './billing/invoice-pdf.service';
import { BillableRollupService } from './billing/billable-rollup.service';
import { InvoiceStatusPoller } from './billing/invoice-status.poller';
import { BillingController } from './billing/billing.controller';
import { ACCOUNTING_OPS_PORT } from './billing/accounting-ops.port';
import { HttpAccountingOpsClient } from './billing/http-accounting-ops.client';

/**
 * Time Tracking + Billable Rollup — the professional-services spine.
 * Behind TIME_TRACKING_ENABLED (default on). Exports the service surface so
 * the MCP layer can expose the same operations as per-user-scoped tools.
 */
@Module({
  imports: [PrismaModule, AuditModule, DocumentsModule],
  controllers: [
    TimeEntriesController,
    TimesheetsController,
    BillingRatesController,
    ReportsController,
    BillingController,
  ],
  providers: [
    WorkspaceContextService,
    MembershipService,
    TimeTrackingEnabledGuard,
    RoundingService,
    RateResolverService,
    EntryFinancialsService,
    TimerService,
    TimeEntryService,
    BillingRateService,
    TimesheetService,
    ReportsService,
    BillableDraftAssembler,
    InvoicePdfService,
    BillableRollupService,
    InvoiceStatusPoller,
    { provide: ACCOUNTING_OPS_PORT, useClass: HttpAccountingOpsClient },
  ],
  exports: [
    WorkspaceContextService,
    MembershipService,
    TimerService,
    TimeEntryService,
    BillingRateService,
    TimesheetService,
    ReportsService,
    BillableRollupService,
  ],
})
export class TimeTrackingModule {}
