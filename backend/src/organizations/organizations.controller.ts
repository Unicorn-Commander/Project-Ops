import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  ParseBoolPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { UserRole, OrgType, User } from '@prisma/client';
import { clampLimit } from '../common/pagination/clamp';

/**
 * Suite tenancy (Phase 2, B5): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error or circular reference' })
  @ApiResponse({ status: 404, description: 'Parent organization not found' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createOrganizationDto: CreateOrganizationDto,
  ) {
    return this.organizationsService.create(workspaceId, user, createOrganizationDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all organizations with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'type', required: false, enum: OrgType })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns list of organizations' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('type') type?: OrgType,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    // Clamp to a bounded page size (default 20, max 100) so a caller can't pull
    // the whole org table in one request with ?limit=100000.
    const safeLimit = clampLimit(limit);
    const safePage = page > 0 ? page : 1;
    const skip = (safePage - 1) * safeLimit;
    const where: any = {};

    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { taxId: { contains: search, mode: 'insensitive' } },
        { industry: { contains: search, mode: 'insensitive' } },
      ];
    }

    const { organizations, total } = await this.organizationsService.findAll(workspaceId, user, {
      skip,
      take: safeLimit,
      where,
      orderBy: { createdAt: 'desc' },
      userRole: user?.role,
      userId: user?.id,
    });

    return {
      data: organizations,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get organization statistics for dashboard' })
  @ApiResponse({ status: 200, description: 'Returns organization statistics' })
  getStats(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.organizationsService.getStats(workspaceId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiResponse({ status: 200, description: 'Returns organization details' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.organizationsService.findOne(workspaceId, user, id);
  }

  @Get(':id/hierarchy')
  @ApiOperation({ summary: 'Get organization with full child hierarchy' })
  @ApiResponse({ status: 200, description: 'Returns organization with complete hierarchy tree' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getHierarchy(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.organizationsService.getHierarchy(workspaceId, user, id);
  }

  @Get(':id/contacts')
  @ApiOperation({ summary: 'Get all contacts for organization' })
  @ApiResponse({ status: 200, description: 'Returns list of contacts' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getContacts(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.organizationsService.getContacts(workspaceId, user, id);
  }

  @Get(':id/projects')
  @ApiOperation({ summary: 'Get all projects for organization' })
  @ApiQuery({ name: 'includeChildren', required: false, type: Boolean, description: 'Include projects from child organizations' })
  @ApiResponse({ status: 200, description: 'Returns list of projects' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getProjects(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query('includeChildren', new ParseBoolPipe({ optional: true })) includeChildren?: boolean,
  ) {
    return this.organizationsService.getProjects(workspaceId, user, id, includeChildren || false);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update organization' })
  @ApiResponse({ status: 200, description: 'Organization updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error or circular reference' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ) {
    return this.organizationsService.update(workspaceId, user, id, updateOrganizationDto);
  }

  @Patch(':id/portal-access')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle portal access for organization' })
  @ApiResponse({ status: 200, description: 'Portal access updated successfully' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  togglePortalAccess(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.organizationsService.togglePortalAccess(workspaceId, user, id, body.enabled);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Soft delete organization (sets isActive to false)' })
  @ApiResponse({ status: 200, description: 'Organization deleted successfully' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.organizationsService.remove(workspaceId, user, id);
  }
}
