import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import {
  InternalApprovalBindingDto,
  ListInternalApprovalsDto,
  RecordInternalApprovalDto,
} from './dto/internal-approval.dto';
import { InternalApprovalsService } from './internal-approvals.service';

@ApiTags('internal-approvals')
@ApiBearerAuth('JWT-auth')
@Controller('internal-approvals')
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
export class InternalApprovalsController {
  constructor(private readonly approvals: InternalApprovalsService) {}

  @Post()
  @ApiOperation({ summary: 'Append an internal decision as the authenticated caller' })
  record(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: RecordInternalApprovalDto,
  ) {
    return this.approvals.record(workspaceId, user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the internal approval audit trail, newest first' })
  list(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() dto: ListInternalApprovalsDto,
  ) {
    return this.approvals.list(workspaceId, user, dto);
  }

  @Get('latest')
  @ApiOperation({
    summary: 'Get the latest decision for an exact project/entity/version binding, or null',
  })
  latest(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() dto: InternalApprovalBindingDto,
  ) {
    return this.approvals.latest(workspaceId, user, dto);
  }
}
