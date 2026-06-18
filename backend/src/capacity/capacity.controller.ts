import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { CapacityService } from './capacity.service';
import { CapacityWindowDto } from './dto/capacity-window.dto';
import { SetCapacityDto } from './dto/set-capacity.dto';

/**
 * Capacity / resource planning (Wave 2).
 *
 * Suite tenancy: every route resolves the active workspace via @CurrentWorkspace
 * + the global WorkspaceMembershipGuard (which 403s a non-member when tenancy is
 * ON and stashes the resolved id on req.workspaceId), then passes
 * (workspaceId, user) into the service, which fences all task reads inside that
 * workspace's RLS tx. The guards are also registered GLOBALLY in AppModule;
 * listing them here is idempotent and keeps the controller's intent explicit
 * (matching TasksController).
 *
 * RBAC: the TEAM view and the capacity-setter are ADMIN/MANAGER only (a
 * planning surface over the whole team). `/capacity/me` carries no @Roles so any
 * authenticated member can see their OWN load.
 */
@ApiTags('capacity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Controller('capacity')
export class CapacityController {
  constructor(private readonly capacity: CapacityService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({
    summary:
      'Team capacity: per-user committed hours vs pro-rated weekly capacity across a date window (defaults to the current week)',
  })
  @ApiResponse({ status: 200, description: 'Capacity report retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Requires ADMIN or MANAGER' })
  getTeamCapacity(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: CapacityWindowDto,
  ) {
    return this.capacity.getTeamCapacity(workspaceId, user, query.from, query.to);
  }

  @Get('me')
  @ApiOperation({
    summary: "The current user's own workload across a date window (any member)",
  })
  @ApiResponse({ status: 200, description: 'Capacity report retrieved successfully' })
  getMyCapacity(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: CapacityWindowDto,
  ) {
    return this.capacity.getMyCapacity(workspaceId, user, query.from, query.to);
  }

  @Patch('users/:userId')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: "Set a member's weekly capacity hours (0–168, ADMIN/MANAGER)" })
  @ApiResponse({ status: 200, description: 'Capacity updated successfully' })
  @ApiResponse({ status: 403, description: 'Requires ADMIN or MANAGER' })
  @ApiResponse({ status: 404, description: 'User is not a member of this workspace' })
  setUserCapacity(
    @CurrentWorkspace() workspaceId: string,
    @Param('userId') userId: string,
    @Body() dto: SetCapacityDto,
  ) {
    return this.capacity.setUserCapacity(workspaceId, userId, dto.weeklyCapacityHours);
  }
}
