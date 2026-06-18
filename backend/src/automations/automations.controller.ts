import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AutomationTrigger, User, UserRole } from '@prisma/client';
import { AutomationsService } from './automations.service';
import { CreateAutomationRuleDto } from './dto/create-automation-rule.dto';
import { UpdateAutomationRuleDto } from './dto/update-automation-rule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';

/**
 * Automation rules CRUD.
 *
 * Suite tenancy: every route resolves the active workspace via @CurrentWorkspace
 * + the WorkspaceMembershipGuard (listed in @UseGuards) and passes
 * (workspaceId, user) into the service, which runs all DB access inside that
 * workspace's RLS tx. Rules are an admin/manager surface, so every route is
 * @Roles(ADMIN, MANAGER) on top of the membership gate.
 */
@ApiTags('automations')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  @ApiOperation({ summary: 'List automation rules in the active workspace' })
  @ApiResponse({ status: 200, description: 'Rules retrieved' })
  findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('trigger') trigger?: AutomationTrigger,
    @Query('enabled') enabled?: string,
  ) {
    const enabledFilter = enabled === 'true' ? true : enabled === 'false' ? false : undefined;
    return this.automations.findAll(workspaceId, user, {
      trigger: trigger && AutomationTrigger[trigger] ? trigger : undefined,
      enabled: enabledFilter,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one automation rule' })
  @ApiResponse({ status: 200, description: 'Rule retrieved' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.automations.findOne(workspaceId, user, id);
  }

  @Post()
  @ApiOperation({ summary: 'Create an automation rule' })
  @ApiResponse({ status: 201, description: 'Rule created' })
  @ApiResponse({ status: 400, description: 'Invalid actions/conditions shape' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    return this.automations.create(workspaceId, user, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an automation rule' })
  @ApiResponse({ status: 200, description: 'Rule updated' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    return this.automations.update(workspaceId, user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an automation rule' })
  @ApiResponse({ status: 200, description: 'Rule deleted' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.automations.remove(workspaceId, user, id);
  }
}
