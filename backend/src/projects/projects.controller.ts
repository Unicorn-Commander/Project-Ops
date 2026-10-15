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
  Optional,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { AssignProjectDto } from './dto/assign-project.dto';
import { UpdateProjectStatusDto } from './dto/update-status.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { MembershipService } from '../common/workspace/membership.service';
import { clampLimit } from '../common/pagination/clamp';
import { Prisma, UserRole, ProjectStatus, ProjectPriority, User } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, B1): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('projects')
@Controller('projects')
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    @Optional() private readonly membership?: MembershipService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
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
  @ApiOperation({ summary: 'Get all projects with pagination, search, filters and sort' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Page size (max 1000)' })
  @ApiQuery({ name: 'status', required: false, enum: ProjectStatus })
  @ApiQuery({ name: 'priority', required: false, enum: ProjectPriority })
  @ApiQuery({ name: 'assignedToId', required: false, type: String })
  @ApiQuery({
    name: 'customerOpsCustomerId',
    required: false,
    type: String,
    description: 'Exact match on the Customer-Ops customer UUID.',
  })
  @ApiQuery({
    name: 'contactOpsContactId',
    required: false,
    type: String,
    description: 'Exact match on the Contact-Ops contact UUID.',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Case-insensitive match on title / clientName / projectNumber',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['createdAt', 'title', 'status', 'priority', 'dueDate'],
  })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @ApiResponse({ status: 200, description: 'Returns list of projects' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query() query: ListProjectsDto,
  ) {
    // ValidationPipe (transform: true) coerces/validates query into the DTO;
    // page/limit arrive as numbers. Projects allow a higher cap (1000) than the
    // shared default (100): full-list views — the master schedule, dashboard
    // charts, project pickers — legitimately pull every project in a workspace.
    // Still bounded so a caller can't pull an unbounded table in one round-trip.
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = clampLimit(query.limit, 20, 1000);
    const skip = (page - 1) * limit;

    const where: Prisma.ProjectWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.priority) where.priority = query.priority;
    if (query.assignedToId) where.assignedToId = query.assignedToId;
    if (query.customerOpsCustomerId !== undefined) {
      where.customerOpsCustomerId = query.customerOpsCustomerId;
    }
    if (query.contactOpsContactId !== undefined) {
      where.contactOpsContactId = query.contactOpsContactId;
    }

    // Free-text search: case-insensitive (ILIKE) contains across the project's
    // title, the denormalized clientName, and the human projectNumber. Trimmed;
    // a blank/whitespace-only search is ignored.
    const search = query.search?.trim();
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { clientName: { contains: search, mode: 'insensitive' } },
        { projectNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Row-level security based on user role. Applied AFTER search so the
    // role scope (createdById / assignedToId) is ANDed with the OR-search,
    // never widened by it.
    if (user?.role === UserRole.CLIENT) {
      // Clients can only see projects they created
      where.createdById = user.id;
    } else if (
      user?.role === UserRole.STAFF &&
      !(await this.membership?.hasManagementRole(user, workspaceId))
    ) {
      // Ordinary staff see assigned projects; workspace managers see their workspace.
      where.assignedToId = user.id;
    }
    // ADMIN and MANAGER can see all projects (no additional filter)

    // Sort: validated allow-list column + direction (default newest-first).
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = query.sortDir ?? 'desc';
    const orderBy: Prisma.ProjectOrderByWithRelationInput = { [sortBy]: sortDir };

    const { projects, total } = await this.projectsService.findAll(workspaceId, user, {
      skip,
      take: limit,
      where,
      orderBy,
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

  @Get(':projectId/budget')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Get budget burn-down (hours + amount) for a project' })
  @ApiResponse({ status: 200, description: 'Returns the project budget burn-down' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  getBudget(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
  ) {
    return this.projectsService.getBudget(workspaceId, user, projectId);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
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
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
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
