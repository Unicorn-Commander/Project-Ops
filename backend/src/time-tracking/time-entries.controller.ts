import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { TimeTrackingEnabledGuard } from '../common/workspace/time-tracking-enabled.guard';
import { TimerService } from './timer.service';
import { TimeEntryService } from './time-entry.service';
import { StartTimerDto } from './dto/start-timer.dto';
import { CreateTimeEntryDto } from './dto/create-time-entry.dto';
import { UpdateTimeEntryDto } from './dto/update-time-entry.dto';
import { QueryTimeEntriesDto } from './dto/query-time-entries.dto';

@ApiTags('time-entries')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, TimeTrackingEnabledGuard)
@Controller('time-entries')
export class TimeEntriesController {
  constructor(
    private readonly timer: TimerService,
    private readonly entries: TimeEntryService,
  ) {}

  @Post('timer/start')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Start a running timer (stops any existing one for the user)' })
  @ApiResponse({ status: 201, description: 'Timer started' })
  startTimer(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: StartTimerDto,
  ) {
    return this.timer.startTimer(workspaceId, user, dto);
  }

  @Post('timer/stop')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Stop the running timer for the current user' })
  stopTimer(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.timer.stopTimer(workspaceId, user);
  }

  @Get('timer/running')
  @ApiOperation({ summary: 'Get the current running timer, if any' })
  getRunning(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.timer.getRunning(workspaceId, user);
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Log a manual time entry' })
  @ApiResponse({ status: 201, description: 'Time entry created' })
  logTime(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateTimeEntryDto,
  ) {
    return this.entries.logTime(workspaceId, user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List time entries (visibility-scoped, paginated)' })
  list(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: QueryTimeEntriesDto,
  ) {
    return this.entries.list(workspaceId, user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single time entry' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.entries.findOne(workspaceId, user, id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Update a DRAFT, unlocked, unbilled time entry' })
  @ApiResponse({ status: 403, description: 'Locked / billed / not owner' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateTimeEntryDto,
  ) {
    return this.entries.update(workspaceId, user, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Delete a DRAFT, unlocked, unbilled time entry' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.entries.remove(workspaceId, user, id);
  }
}
