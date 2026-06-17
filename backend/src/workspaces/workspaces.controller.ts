import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { SkipWorkspaceMembership } from '../common/workspace/skip-workspace-membership.decorator';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

/**
 * Workspace & member management ("easy sharing").
 *
 * Routing/authz notes:
 *  - The member routes use a `:workspaceId` PATH PARAM (not `:id`) deliberately:
 *    that is the first tier of the guard's D4 addressing precedence, so the
 *    GLOBAL WorkspaceMembershipGuard membership-checks the caller against the
 *    TARGET workspace (when tenancy is ON) before the handler runs. The service
 *    additionally enforces the suite RANK (OWNER/ADMIN) for every manage op, so
 *    authorization is correct even while the flag is OFF (guard inert).
 *  - POST /workspaces creates a NEW workspace, so there is no membership to
 *    check yet — it opts out with @SkipWorkspaceMembership(). Any authenticated
 *    user may create one and becomes its OWNER.
 *
 * JwtAuthGuard + WorkspaceMembershipGuard are also registered GLOBALLY in
 * AppModule; listing them here is idempotent and keeps the controller's intent
 * explicit (matching ContactsController).
 */
@ApiTags('workspaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Post()
  @SkipWorkspaceMembership()
  @ApiOperation({ summary: 'Create a workspace (caller becomes OWNER)' })
  @ApiResponse({ status: 201, description: 'Workspace created' })
  create(@CurrentUser() user: User, @Body() dto: CreateWorkspaceDto) {
    return this.workspaces.create(user, dto.displayName);
  }

  @Get(':workspaceId/members')
  @ApiOperation({ summary: 'List members of a workspace (any member)' })
  @ApiResponse({ status: 200, description: 'List of members + pending invites' })
  @ApiResponse({ status: 403, description: 'Not a member of this workspace' })
  listMembers(@CurrentUser() user: User, @Param('workspaceId') workspaceId: string) {
    return this.workspaces.listMembers(user, workspaceId);
  }

  @Post(':workspaceId/members')
  @ApiOperation({ summary: 'Add/share a workspace by email (OWNER or ADMIN)' })
  @ApiResponse({ status: 201, description: 'Member added or invite created' })
  @ApiResponse({ status: 403, description: 'Requires OWNER or ADMIN' })
  addMember(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.workspaces.addMember(user, workspaceId, dto);
  }

  @Patch(':workspaceId/members/:userKey')
  @ApiOperation({ summary: 'Change a member role (OWNER only)' })
  @ApiResponse({ status: 200, description: 'Role updated' })
  @ApiResponse({ status: 400, description: 'Cannot demote the last owner' })
  @ApiResponse({ status: 403, description: 'Requires OWNER' })
  updateMemberRole(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('userKey') userKey: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.workspaces.updateMemberRole(user, workspaceId, userKey, dto.role);
  }

  @Delete(':workspaceId/members/:userKey')
  @ApiOperation({ summary: 'Remove a member (OWNER only)' })
  @ApiResponse({ status: 200, description: 'Member removed' })
  @ApiResponse({ status: 400, description: 'Cannot remove the last owner' })
  @ApiResponse({ status: 403, description: 'Requires OWNER' })
  removeMember(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('userKey') userKey: string,
  ) {
    return this.workspaces.removeMember(user, workspaceId, userKey);
  }
}
