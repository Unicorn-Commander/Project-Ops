import { Controller, Get, Query, UseGuards, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { TimeTrackingEnabledGuard } from '../common/workspace/time-tracking-enabled.guard';
import { ReportsService } from './reports.service';

@ApiTags('time-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, TimeTrackingEnabledGuard)
@Controller('time-reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('utilization')
  @ApiOperation({ summary: 'Utilization (billable/total hours) by user' })
  utilization(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('userId') userId?: string,
  ) {
    return this.reports.getUtilization(workspaceId, user, { from, to, userId });
  }

  @Get('realization')
  @ApiOperation({ summary: 'Realization (billed/billable amount)' })
  realization(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.getRealization(workspaceId, user, { from, to });
  }

  @Get('wip')
  @ApiOperation({ summary: 'Work in progress (approved, unbilled value) by project' })
  wip(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.reports.getWip(workspaceId, user);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="time-entries.csv"')
  @ApiOperation({ summary: 'Export time entries as CSV (never includes cost for CLIENT)' })
  exportCsv(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.reports.exportCsv(workspaceId, user, { from, to, projectId });
  }
}
