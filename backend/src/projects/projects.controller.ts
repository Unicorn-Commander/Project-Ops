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
import { UserRole, ProjectStatus, ProjectPriority, User } from '@prisma/client';

@ApiTags('projects')
@Controller('projects')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth('JWT-auth')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new project' })
  @ApiResponse({ status: 201, description: 'Project created successfully' })
  create(@Body() createProjectDto: CreateProjectDto, @CurrentUser() user: User) {
    return this.projectsService.create(createProjectDto, user.id);
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
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('status') status?: ProjectStatus,
    @Query('priority') priority?: ProjectPriority,
    @Query('assignedToId') assignedToId?: string,
    @CurrentUser() user?: User,
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

    const { projects, total } = await this.projectsService.findAll({
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
  getStatsByStatus(@CurrentUser() user: User) {
    return this.projectsService.getStatsByStatus(user);
  }

  @Get('stats/priority')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Get project statistics by priority' })
  @ApiResponse({ status: 200, description: 'Returns project statistics' })
  getStatsByPriority(@CurrentUser() user: User) {
    return this.projectsService.getStatsByPriority(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project by ID' })
  @ApiResponse({ status: 200, description: 'Returns project details' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  findOne(@Param('id') id: string) {
    return this.projectsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update project' })
  @ApiResponse({ status: 200, description: 'Project updated successfully' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  update(
    @Param('id') id: string,
    @Body() updateProjectDto: UpdateProjectDto,
    @CurrentUser() user: User,
  ) {
    return this.projectsService.update(id, updateProjectDto, user.id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update project status' })
  @ApiResponse({ status: 200, description: 'Project status updated successfully' })
  updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateProjectStatusDto,
    @CurrentUser() user: User,
  ) {
    return this.projectsService.updateStatus(id, updateStatusDto.status, user.id);
  }

  @Patch(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Assign project to user' })
  @ApiResponse({ status: 200, description: 'Project assigned successfully' })
  assignProject(
    @Param('id') id: string,
    @Body() assignProjectDto: AssignProjectDto,
    @CurrentUser() user: User,
  ) {
    return this.projectsService.assignProject(id, assignProjectDto, user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete project' })
  @ApiResponse({ status: 200, description: 'Project deleted successfully' })
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.projectsService.remove(id, user.id);
  }
}
