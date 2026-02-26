import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
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
import { UserRole, TaskStatus, TaskPriority } from '@prisma/client';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a new task' })
  @ApiResponse({ status: 201, description: 'Task created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Project or user not found' })
  create(@Body() createTaskDto: CreateTaskDto, @Request() req) {
    return this.tasksService.create(createTaskDto, req.user.id);
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

    return this.tasksService.findAll({
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
  getMyTasks(@Request() req) {
    return this.tasksService.getUserTasks(req.user.id);
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Get all overdue tasks' })
  @ApiResponse({ status: 200, description: 'Overdue tasks retrieved successfully' })
  getOverdueTasks() {
    return this.tasksService.getOverdueTasks();
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get all tasks for a specific project' })
  @ApiResponse({ status: 200, description: 'Project tasks retrieved successfully' })
  getProjectTasks(@Param('projectId') projectId: string) {
    return this.tasksService.getProjectTasks(projectId);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get all tasks assigned to a specific user' })
  @ApiResponse({ status: 200, description: 'User tasks retrieved successfully' })
  getUserTasks(@Param('userId') userId: string) {
    return this.tasksService.getUserTasks(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task by ID' })
  @ApiResponse({ status: 200, description: 'Task retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a task' })
  @ApiResponse({ status: 200, description: 'Task updated successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  update(@Param('id') id: string, @Body() updateTaskDto: UpdateTaskDto, @Request() req) {
    return this.tasksService.update(id, updateTaskDto, req.user.id, req.user.role);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update task status' })
  @ApiResponse({ status: 200, description: 'Task status updated successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  updateStatus(@Param('id') id: string, @Body() updateStatusDto: UpdateTaskStatusDto) {
    return this.tasksService.updateStatus(id, updateStatusDto.status);
  }

  @Patch(':id/assign')
  @Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF)
  @ApiOperation({ summary: 'Assign task to a user' })
  @ApiResponse({ status: 200, description: 'Task assigned successfully' })
  @ApiResponse({ status: 404, description: 'Task or user not found' })
  assignTask(@Param('id') id: string, @Body() assignTaskDto: AssignTaskDto) {
    return this.tasksService.assignTask(id, assignTaskDto.assignedToId);
  }

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark task as completed' })
  @ApiResponse({ status: 200, description: 'Task marked as completed' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  markComplete(@Param('id') id: string, @Request() req) {
    return this.tasksService.markComplete(id, req.user.id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete a task (admin only)' })
  @ApiResponse({ status: 200, description: 'Task deleted successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  remove(@Param('id') id: string) {
    return this.tasksService.remove(id);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a comment to a task' })
  @ApiResponse({ status: 201, description: 'Comment added successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  addComment(
    @Param('id') id: string,
    @Body() createCommentDto: CreateTaskCommentDto,
    @Request() req,
  ) {
    return this.tasksService.addComment(id, createCommentDto, req.user.id);
  }

  @Get(':id/comments')
  @ApiOperation({ summary: 'Get all comments for a task' })
  @ApiResponse({ status: 200, description: 'Comments retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Task not found' })
  getComments(@Param('id') id: string) {
    return this.tasksService.getTaskComments(id);
  }
}
