import { Controller, Get, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { UserRole, User } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, B7): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview statistics' })
  @ApiResponse({ status: 200, description: 'Returns overview statistics' })
  getOverview(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    return this.dashboardService.getOverview(workspaceId, user);
  }

  @Get('project-statistics')
  @ApiOperation({ summary: 'Get project statistics' })
  @ApiResponse({ status: 200, description: 'Returns project statistics' })
  getProjectStatistics(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    return this.dashboardService.getProjectStatistics(workspaceId, user);
  }

  @Get('upcoming-due-dates')
  @ApiOperation({ summary: 'Get projects with upcoming due dates' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Returns projects with upcoming due dates' })
  getUpcomingDueDates(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('days', new ParseIntPipe({ optional: true })) days: number = 7,
  ) {
    return this.dashboardService.getUpcomingDueDates(workspaceId, days, user);
  }

  @Get('user-activity')
  @ApiOperation({ summary: 'Get current user activity statistics' })
  @ApiResponse({ status: 200, description: 'Returns user activity statistics' })
  getUserActivity(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
  ) {
    return this.dashboardService.getUserActivity(workspaceId, user);
  }

  @Get('recent-activity')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get recent system activity' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Returns recent activity' })
  getRecentActivity(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    return this.dashboardService.getRecentActivity(workspaceId, user, limit);
  }

  @Get('monthly-stats')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get monthly statistics' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number })
  @ApiResponse({ status: 200, description: 'Returns monthly statistics' })
  getMonthlyStats(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.dashboardService.getMonthlyStats(workspaceId, user, year, month);
  }
}
