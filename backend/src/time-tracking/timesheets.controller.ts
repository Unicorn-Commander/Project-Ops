import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { TimeTrackingEnabledGuard } from '../common/workspace/time-tracking-enabled.guard';
import { TimesheetService } from './timesheet.service';
import { SubmitTimesheetDto, ApproveTimeDto, RejectTimeDto } from './dto/timesheet.dto';

@ApiTags('timesheets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, TimeTrackingEnabledGuard)
@Controller('timesheets')
export class TimesheetsController {
  constructor(private readonly timesheets: TimesheetService) {}

  @Post('submit')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: "Submit the current user's weekly timesheet for approval" })
  @ApiResponse({ status: 201, description: 'Timesheet submitted' })
  submit(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: SubmitTimesheetDto,
  ) {
    return this.timesheets.submit(workspaceId, user, dto);
  }

  @Post('approve')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Approve submitted time (whole period or specific entries)' })
  approve(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: ApproveTimeDto,
  ) {
    return this.timesheets.approve(workspaceId, user, dto);
  }

  @Post('reject')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Reject submitted time with a reason (returns entries to DRAFT)' })
  reject(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: RejectTimeDto,
  ) {
    return this.timesheets.reject(workspaceId, user, dto);
  }
}
