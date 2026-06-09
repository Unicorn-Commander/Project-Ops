import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { AssignTaskDto } from './dto/assign-task.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { User, UserRole, TaskStatus, TaskPriority } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, B2): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Project or user not found' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createTaskDto: CreateTaskDto,
  ) {
    return this.tasksService.create(workspaceId, user, createTaskDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all tasks with optional filters' })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  @ApiQuery({ name: 'createdById', required: false })
  @ApiQuery({ name: 'status', enum: TaskStatus, required: false })
  @ApiQuery({ name: 'priority', enum: TaskPriority, required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Tasks retrieved successfully' })
  findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('projectId') projectId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('createdById') createdById?: string,
    @Query('status') status?: TaskStatus,
    @Query('priority') priority?: TaskPriority,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize, 10) : 50;
    const skip = (pageNum - 1) * pageSizeNum;

    return this.tasksService.findAll(workspaceId, user, {
      projectId,
      assignedToId,
      createdById,
      status,
      priority,
      skip,
      take: pageSizeNum,
    });
  }

  @Get('my-tasks')
  @ApiOperation({ summary: 'Get tasks assigned to current user' })
  @ApiResponse({ status: 200, description: 'User tasks retrieved successfully' })
  getMyTasks(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.tasksService.getUserTasks(workspaceId, user, user.id);
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Get all overdue tasks' })
  @ApiResponse({ status: 200, description: 'Overdue tasks retrieved successfully' })
  getOverdueTasks(@CurrentWorkspace() workspaceId: string, @CurrentUser() user: User) {
    return this.tasksService.getOverdueTasks(workspaceId, user);
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get all tasks for a specific project' })
  @ApiResponse({ status: 200, description: 'Project tasks retrieved successfully' })
  getProjectTasks(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
  ) {
    return this.tasksService.getProjectTasks(workspaceId, user, projectId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all tasks assigned to a specific user' })
  @ApiResponse({ status: 200, description: 'User tasks retrieved successfully' })
  getUserTasks(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('userId') userId: string,
  ) {
    return this.tasksService.getUserTasks(workspaceId, user, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task by ID' })
  @ApiResponse({ status: 200, description: 'Task retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.tasksService.findOne(workspaceId, user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({ status: 200, description: 'Task updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ) {
    return this.tasksService.update(workspaceId, user, id, updateTaskDto, user.role);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status' })
  @ApiResponse({ status: 200, description: 'Task status updated successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  updateStatus(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateTaskStatusDto,
  ) {
    return this.tasksService.updateStatus(workspaceId, user, id, updateStatusDto.status);
  }

  @Patch(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Assign task to a user' })
  @ApiResponse({ status: 200, description: 'Task assigned successfully' })
  @ApiResponse({ status: 404, description: 'Task or user not found' })
  assignTask(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() assignTaskDto: AssignTaskDto,
  ) {
    return this.tasksService.assignTask(workspaceId, user, id, assignTaskDto.assignedToId);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark task as completed' })
  @ApiResponse({ status: 200, description: 'Task marked as completed' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  markComplete(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.tasksService.markComplete(workspaceId, user, id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a task (admin only)' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.tasksService.remove(workspaceId, user, id);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  @ApiResponse({ status: 201, description: 'Comment added successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  addComment(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() createCommentDto: CreateTaskCommentDto,
  ) {
    return this.tasksService.addComment(workspaceId, user, id, createCommentDto);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get all comments for a task' })
  @ApiResponse({ status: 200, description: 'Comments retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  getComments(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.tasksService.getTaskComments(workspaceId, user, id);
  }
}
