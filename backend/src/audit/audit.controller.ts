import {
  Controller,
  Get,
  Query,
  Param,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole, AuditAction } from '@prisma/client';

@ApiTags('audit')
@Controller('audit')
@UseGuards(JwtAuthGuard, RolesGuard)
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
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 50,
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

    const { logs, total } = await this.auditService.findAll({
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
  findByUser(@Param('userId') userId: string) {
    return this.auditService.findByUser(userId);
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get audit logs for a specific project' })
  @ApiResponse({ status: 200, description: 'Returns project audit logs' })
  findByProject(@Param('projectId') projectId: string) {
    return this.auditService.findByProject(projectId);
  }

  @Get('resource/:resource/:resourceId')
  @ApiOperation({ summary: 'Get audit logs for a specific resource' })
  @ApiResponse({ status: 200, description: 'Returns resource audit logs' })
  findByResource(@Param('resource') resource: string, @Param('resourceId') resourceId: string) {
    return this.auditService.findByResource(resource, resourceId);
  }

  @Get('stats/action')
  @ApiOperation({ summary: 'Get audit statistics by action' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns action statistics' })
  getStatsByAction(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.auditService.getStatsByAction(start, end);
  }

  @Get('stats/resource')
  @ApiOperation({ summary: 'Get audit statistics by resource' })
  @ApiQuery({ name: 'startDate', required: false, type: String })
  @ApiQuery({ name: 'endDate', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns resource statistics' })
  getStatsByResource(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    return this.auditService.getStatsByResource(start, end);
  }
}