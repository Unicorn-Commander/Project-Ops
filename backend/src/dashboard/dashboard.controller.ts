import { Controller, Get, Query, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, User } from '@prisma/client';

@ApiTags('dashboard')
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get dashboard overview statistics' })
  @ApiResponse({ status: 200, description: 'Returns overview statistics' })
  getOverview(@CurrentUser() user: User) {
    return this.dashboardService.getOverview(user);
  }

  @Get('project-statistics')
  @ApiOperation({ summary: 'Get project statistics' })
  @ApiResponse({ status: 200, description: 'Returns project statistics' })
  getProjectStatistics(@CurrentUser() user: User) {
    return this.dashboardService.getProjectStatistics(user);
  }

  @Get('upcoming-due-dates')
  @ApiOperation({ summary: 'Get projects with upcoming due dates' })
  @ApiQuery({ name: 'days', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Returns projects with upcoming due dates' })
  getUpcomingDueDates(
    @Query('days', new ParseIntPipe({ optional: true })) days: number = 7,
    @CurrentUser() user: User,
  ) {
    return this.dashboardService.getUpcomingDueDates(days, user);
  }

  @Get('user-activity')
  @ApiOperation({ summary: 'Get current user activity statistics' })
  @ApiResponse({ status: 200, description: 'Returns user activity statistics' })
  getUserActivity(@CurrentUser() user: User) {
    return this.dashboardService.getUserActivity(user.id);
  }

  @Get('recent-activity')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get recent system activity' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Returns recent activity' })
  getRecentActivity(
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
  ) {
    return this.dashboardService.getRecentActivity(limit);
  }

  @Get('monthly-stats')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get monthly statistics' })
  @ApiQuery({ name: 'year', required: true, type: Number })
  @ApiQuery({ name: 'month', required: true, type: Number })
  @ApiResponse({ status: 200, description: 'Returns monthly statistics' })
  getMonthlyStats(
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.dashboardService.getMonthlyStats(year, month);
  }
}