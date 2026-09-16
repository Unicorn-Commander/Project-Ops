import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { User, WorkspaceRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { InvitationSessionGuard } from '../auth/guards/invitation-session.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipWorkspaceMembership } from '../common/workspace/skip-workspace-membership.decorator';
import { WorkspaceInvitationsService } from './workspace-invitations.service';
class CreateInvitationDto {
  @IsEmail() @MaxLength(255) email: string;
  @IsOptional() @IsEnum(WorkspaceRole) role?: WorkspaceRole;
}
class AcceptInvitationDto {
  @IsString() @MinLength(43) @MaxLength(43) token: string;
}
@Controller()
@UseGuards(JwtAuthGuard, InvitationSessionGuard)
export class WorkspaceInvitationsController {
  constructor(private readonly invites: WorkspaceInvitationsService) {}
  @Post('workspaces/:workspaceId/invitations')
  create(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Body() body: CreateInvitationDto,
  ) {
    return this.invites.create(user, workspaceId, body.email, body.role ?? WorkspaceRole.MEMBER);
  }
  @Get('workspaces/:workspaceId/invitations')
  list(@CurrentUser() user: User, @Param('workspaceId') workspaceId: string) {
    return this.invites.list(user, workspaceId);
  }
  @Delete('workspaces/:workspaceId/invitations/:id')
  revoke(
    @CurrentUser() user: User,
    @Param('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ) {
    return this.invites.revoke(user, workspaceId, id);
  }
  @Post('workspace-invitations/accept')
  @SkipWorkspaceMembership()
  accept(@CurrentUser() user: User, @Body() body: AcceptInvitationDto) {
    return this.invites.accept(user, body.token);
  }
}
