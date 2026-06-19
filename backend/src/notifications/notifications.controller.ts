import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';

/**
 * Suite tenancy: every route resolves the active workspace via
 * @CurrentWorkspace + the (global, also-listed) WorkspaceMembershipGuard and
 * passes (workspaceId, user) into the service, which runs all DB access inside
 * that workspace's RLS tx AND filters by the current user's id — a member only
 * ever sees/mutates their OWN notifications.
 */
@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's notifications (newest first)" })
  @ApiOkResponse({ description: 'Paginated notifications + unread count' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: QueryNotificationsDto,
  ) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const unreadOnly = query.unreadOnly === 'true';

    const { notifications, total, unreadCount } = await this.notificationsService.findForUser(
      workspaceId,
      user,
      {
        skip,
        take: limit,
        unreadOnly,
      },
    );

    return {
      data: notifications,
      meta: {
        total,
        unreadCount,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: "Count the current user's unread notifications" })
  @ApiOkResponse({ description: '{ count }' })
  async unreadCount(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    const count = await this.notificationsService.unreadCount(workspaceId, user);
    return { count };
  }

  // ── Email preferences ──────────────────────────────────────────────────────
  // Per-user EMAIL delivery preferences (closes the Settings "Notifications —
  // coming soon" stub). These are workspace-AGNOSTIC (stored on the global User
  // row) — they govern EMAIL only; in-app notifications above are always on.

  @Get('preferences')
  @ApiOperation({
    summary: "Get the current user's email-notification preferences (merged over defaults)",
  })
  @ApiOkResponse({ description: '{ email, events: {...} }' })
  getPreferences(@CurrentUser() user: User) {
    return this.notificationsService.getPreferences(user);
  }

  @Patch('preferences')
  @ApiOperation({
    summary: "Partially update the current user's email-notification preferences",
  })
  @ApiOkResponse({ description: 'The full updated preferences' })
  updatePreferences(@CurrentUser() user: User, @Body() body: UpdatePreferencesDto) {
    return this.notificationsService.updatePreferences(user, body);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a single notification read' })
  @ApiOkResponse({ description: 'The updated notification' })
  markRead(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markRead(workspaceId, user, id);
  }

  @Post('read-all')
  @ApiOperation({ summary: "Mark all of the current user's notifications read" })
  @ApiOkResponse({ description: '{ updated }' })
  markAllRead(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.notificationsService.markAllRead(workspaceId, user);
  }
}
