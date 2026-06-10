import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { User, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { TimeTrackingEnabledGuard } from '../common/workspace/time-tracking-enabled.guard';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { BillingRateService } from './billing-rate.service';
import { CreateBillingRateDto } from './dto/create-billing-rate.dto';

// Rates carry internal cost — ADMIN/MANAGER only.
@ApiTags('billing-rates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, TimeTrackingEnabledGuard, WorkspaceMembershipGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('billing-rates')
export class BillingRatesController {
  constructor(private readonly rates: BillingRateService) {}

  @Post()
  @ApiOperation({ summary: 'Create a billing rate at a given scope' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() dto: CreateBillingRateDto,
  ) {
    return this.rates.create(workspaceId, user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List billing rates' })
  findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('scopeType') scopeType?: string,
    @Query('projectId') projectId?: string,
    @Query('userId') userId?: string,
  ) {
    return this.rates.findAll(workspaceId, user, { scopeType, projectId, userId });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a billing rate' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: Partial<CreateBillingRateDto>,
  ) {
    return this.rates.update(workspaceId, user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a billing rate' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.rates.remove(workspaceId, user, id);
  }
}
