import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { User, UserRole, AuditAction } from '@prisma/client';

/**
 * Audit log read surface (ADMIN/MANAGER only).
 *
 * Suite tenancy (Phase 2, B8): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all read DB access inside that workspace's RLS
 * tx. Inert while PROJECT_OPS_TENANCY_ENABLED is off.
 */
@ApiTags('audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Get audit logs with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'action', required: false, enum: AuditAction })
  @ApiQuery({ name: 'resource', required: false, type: String })
  @ApiQuery({ name: 'userId', required: false, type: String })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns audit logs' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('action') action?: AuditAction,
    @Query('resource') resource?: string,
    @Query('userId') userId?: string,
    @Query('projectId') projectId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (action) where.action = action;
    if (resource) where.resource = resource;
    if (userId) where.userId = userId;
    if (projectId) where.projectId = projectId;

    const { logs, total } = await this.auditService.findAll(workspaceId, user, {
      skip,
      take: limit,
      where,
      orderBy: { timestamp: 'desc' },
    });

    return {
      data: logs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get audit logs for a specific user' })
  @ApiResponse({ status: 200, description: 'Returns user audit logs' })
  findByUser(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('userId') userId: string,
  ) {
    return this.auditService.findByUser(workspaceId, user, userId);
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get audit logs for a specific project' })
  @ApiResponse({ status: 200, description: 'Returns project audit logs' })
  findByProject(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
  ) {
    return this.auditService.findByProject(workspaceId, user, projectId);
  }

  @Get('resource/:resource/:resourceId')
  @ApiOperation({ summary: 'Get audit logs for a specific resource' })
  @ApiResponse({ status: 200, description: 'Returns resource audit logs' })
  findByResource(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('resource') resource: string,
    @Param('resourceId') resourceId: string,
  ) {
    return this.auditService.findByResource(workspaceId, user, resource, resourceId);
  }

  @Get('stats/action')
  @ApiOperation({ summary: 'Get audit statistics by action' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns action statistics' })
  getStatsByAction(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.auditService.getStatsByAction(workspaceId, user, start, end);
  }

  @Get('stats/resource')
  @ApiOperation({ summary: 'Get audit statistics by resource' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns resource statistics' })
  getStatsByResource(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.auditService.getStatsByResource(workspaceId, user, start, end);
  }
}
