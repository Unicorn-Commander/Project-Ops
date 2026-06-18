import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { ReportingService } from './reporting.service';

/**
 * Portfolio / profitability / throughput reporting (Wave 2). Guarded exactly
 * like the other workspace-scoped controllers (JwtAuthGuard + RolesGuard +
 * WorkspaceMembershipGuard); the service runs every query inside the active
 * workspace's RLS tx. Profitability exposes internal cost/margin so it is
 * additionally restricted to MANAGER/ADMIN.
 */
@ApiTags('reporting')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Controller('reporting')
export class ReportingController {
  constructor(private readonly reporting: ReportingService) {}

  @Get('portfolio')
  @ApiOperation({ summary: 'Per-project health roll-up + workspace totals' })
  portfolio(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.reporting.getPortfolio(workspaceId, user);
  }

  @Get('profitability')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary: 'Per-project + workspace profitability (billable, cost, margin, realization)',
  })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  profitability(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reporting.getProfitability(workspaceId, user, { from, to });
  }

  @Get('throughput')
  @ApiOperation({ summary: 'Tasks/projects completed over a window (by week + status)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  throughput(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reporting.getThroughput(workspaceId, user, { from, to });
  }
}
