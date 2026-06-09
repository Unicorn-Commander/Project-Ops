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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { UpdateProjectStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { UserRole, ProjectStatus, ProjectPriority, User } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, B1): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createProjectDto: CreateProjectDto,
  ) {
    return this.projectsService.create(workspaceId, user, createProjectDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all projects with pagination and filters' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, enum: ProjectStatus })
  @ApiQuery({ name: 'priority', required: false, enum: ProjectPriority })
  @ApiQuery({ name: 'assignedToId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns list of projects' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('status') status?: ProjectStatus,
    @Query('priority') priority?: ProjectPriority,
    @Query('assignedToId') assignedToId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (assignedToId) where.assignedToId = assignedToId;

    // Row-level security based on user role
    if (user?.role === UserRole.CLIENT) {
      // Clients can only see projects they created
      where.createdById = user.id;
    } else if (user?.role === UserRole.STAFF) {
      // Staff can only see projects assigned to them
      where.assignedToId = user.id;
    }
    // ADMIN and MANAGER can see all projects (no additional filter)

    const { projects, total } = await this.projectsService.findAll(workspaceId, user, {
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

    return {
      data: projects,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('stats/status')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Get project statistics by status' })
  @ApiResponse({ status: 200, description: 'Returns project statistics' })
  getStatsByStatus(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.projectsService.getStatsByStatus(workspaceId, user);
  }

  @Get('stats/priority')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Get project statistics by priority' })
  @ApiResponse({ status: 200, description: 'Returns project statistics' })
  getStatsByPriority(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.projectsService.getStatsByPriority(workspaceId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project by ID' })
  @ApiResponse({ status: 200, description: 'Returns project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.projectsService.findOne(workspaceId, user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update project' })
  @ApiResponse({ status: 200, description: 'Project updated successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectsService.update(workspaceId, user, id, updateProjectDto);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update project status' })
  @ApiResponse({ status: 200, description: 'Project status updated successfully' })
  updateStatus(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateProjectStatusDto,
  ) {
    return this.projectsService.updateStatus(workspaceId, user, id, updateStatusDto.status);
  }

  @Patch(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Assign project to user' })
  @ApiResponse({ status: 200, description: 'Project assigned successfully' })
  assignProject(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() assignProjectDto: AssignProjectDto,
  ) {
    return this.projectsService.assignProject(workspaceId, user, id, assignProjectDto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete project' })
  @ApiResponse({ status: 200, description: 'Project deleted successfully' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.projectsService.remove(workspaceId, user, id);
  }
}
