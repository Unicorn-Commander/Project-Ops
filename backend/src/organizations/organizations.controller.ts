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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserRole, OrgType, User } from '@prisma/client';

@ApiTags('organizations')
@Controller('organizations')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new organization' })
  @ApiResponse({ status: 201, description: 'Organization created successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error or circular reference' })
  @ApiResponse({ status: 404, description: 'Parent organization not found' })
  create(@Body() createOrganizationDto: CreateOrganizationDto, @CurrentUser() user: User) {
    return this.organizationsService.create(createOrganizationDto, user.id);
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
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('type') type?: OrgType,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: User,
  ) {
    const skip = (page - 1) * limit;
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

    const { organizations, total } = await this.organizationsService.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
      userRole: user?.role,
      userId: user?.id,
    });

    return {
      data: organizations,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('stats')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get organization statistics for dashboard' })
  @ApiResponse({ status: 200, description: 'Returns organization statistics' })
  getStats() {
    return this.organizationsService.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get organization by ID' })
  @ApiResponse({ status: 200, description: 'Returns organization details' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  findOne(@Param('id') id: string) {
    return this.organizationsService.findOne(id);
  }

  @Get(':id/hierarchy')
  @ApiOperation({ summary: 'Get organization with full child hierarchy' })
  @ApiResponse({ status: 200, description: 'Returns organization with complete hierarchy tree' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getHierarchy(@Param('id') id: string) {
    return this.organizationsService.getHierarchy(id);
  }

  @Get(':id/contacts')
  @ApiOperation({ summary: 'Get all contacts for organization' })
  @ApiResponse({ status: 200, description: 'Returns list of contacts' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getContacts(@Param('id') id: string) {
    return this.organizationsService.getContacts(id);
  }

  @Get(':id/projects')
  @ApiOperation({ summary: 'Get all projects for organization' })
  @ApiQuery({ name: 'includeChildren', required: false, type: Boolean, description: 'Include projects from child organizations' })
  @ApiResponse({ status: 200, description: 'Returns list of projects' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  getProjects(
    @Param('id') id: string,
    @Query('includeChildren', new ParseBoolPipe({ optional: true })) includeChildren?: boolean,
  ) {
    return this.organizationsService.getProjects(id, includeChildren || false);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update organization' })
  @ApiResponse({ status: 200, description: 'Organization updated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request - validation error or circular reference' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  update(@Param('id') id: string, @Body() updateOrganizationDto: UpdateOrganizationDto) {
    return this.organizationsService.update(id, updateOrganizationDto);
  }

  @Patch(':id/portal-access')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Toggle portal access for organization' })
  @ApiResponse({ status: 200, description: 'Portal access updated successfully' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  togglePortalAccess(@Param('id') id: string, @Body() body: { enabled: boolean }) {
    return this.organizationsService.togglePortalAccess(id, body.enabled);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Soft delete organization (sets isActive to false)' })
  @ApiResponse({ status: 200, description: 'Organization deleted successfully' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  remove(@Param('id') id: string) {
    return this.organizationsService.remove(id);
  }
}
