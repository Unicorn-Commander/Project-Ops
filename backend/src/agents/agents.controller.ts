import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AgentVia, User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { AgentEventsService } from './agent-events.service';
import { AgentActivityQueryDto, AgentsWindowDto } from './dto/agents-query.dto';
import { SetBillableDto } from './dto/set-billable.dto';

/**
 * Agent activity & usage — the agent analog of time-tracking's reporting.
 *
 * Guarded exactly like the other workspace-scoped, privileged read surfaces
 * (reporting/capacity): JwtAuthGuard + RolesGuard (ADMIN/MANAGER) +
 * WorkspaceMembershipGuard. The service runs every query inside the active
 * workspace's RLS tx. Agent cost/usage is internal spend, so the whole surface
 * is MANAGER/ADMIN — no CLIENT/STAFF access.
 *
 * Paging note: limit/offset use DefaultValuePipe + ParseIntPipe (NOT
 * `ParseIntPipe({ optional: true })`, which 400s on a MISSING param in this
 * stack). The DTO declares them optional for validation/Swagger; the pipes
 * supply the defaults and coerce.
 */
@ApiTags('agents')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('agents')
export class AgentsController {
  constructor(private readonly agents: AgentEventsService) {}

  @Get()
  @ApiOperation({ summary: 'Agent roster — one row per agent + workspace totals' })
  roster(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.agents.getRoster(workspaceId, user);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Paged agent activity feed (newest first) over a window' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'actorKey', required: false, type: String })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiQuery({ name: 'via', required: false, enum: AgentVia })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  activity(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: AgentActivityQueryDto,
    // Defaults + coercion via the pipe pair (see class note). `limit` capped to
    // a sane page; the DTO's @Max(200) also guards the parsed value.
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.agents.getActivity(workspaceId, user, {
      from: query.from,
      to: query.to,
      actorKey: query.actorKey,
      projectId: query.projectId,
      via: query.via,
      limit: Math.min(Math.max(limit, 1), 200),
      offset: Math.max(offset, 0),
    });
  }

  @Get('usage')
  @ApiOperation({ summary: 'Agent usage & cost over a window — by-agent + series + totals' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  usage(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: AgentsWindowDto,
  ) {
    return this.agents.getUsage(workspaceId, user, query.from, query.to);
  }

  @Patch('activity/:id/billable')
  @ApiOperation({ summary: 'Flag a single agent event billable / not billable' })
  setBillable(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: SetBillableDto,
  ) {
    return this.agents.setBillable(workspaceId, user, id, body.billable);
  }

  // NOTE: the parameterized `:actorKey` route is declared LAST so the static
  // `activity` / `usage` segments are matched first (Nest/Express match in
  // declaration order; otherwise `/agents/usage` would hit `:actorKey`).
  @Get(':actorKey')
  @ApiOperation({ summary: "One agent's detail: identity, totals, by-project, series, recent" })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  agent(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('actorKey') actorKey: string,
    @Query() query: AgentsWindowDto,
  ) {
    return this.agents.getAgent(workspaceId, user, actorKey, query.from, query.to);
  }
}
