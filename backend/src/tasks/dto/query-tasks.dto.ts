import { IsString, IsEnum, IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus, TaskPriority } from '@prisma/client';

/** Columns a tasks listing may be sorted by. */
export enum TaskSortBy {
  createdAt = 'createdAt',
  dueDate = 'dueDate',
  priority = 'priority',
  status = 'status',
  title = 'title',
}

export enum TaskSortDir {
  asc = 'asc',
  desc = 'desc',
}

/**
 * Query params for `GET /tasks`. Existing filters (projectId / assignedToId /
 * createdById / status / priority) are preserved; this adds free-text search,
 * a due-date window, and explicit sort. Pagination stays on `page`/`pageSize`
 * (the controller clamps pageSize ≤ 100). All fields optional.
 */
export class QueryTasksDto {
  @ApiPropertyOptional({ description: 'Filter by project id' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ description: 'Filter by assignee user id' })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiPropertyOptional({ description: 'Filter by creator user id' })
  @IsString()
  @IsOptional()
  createdById?: string;

  @ApiPropertyOptional({
    description: 'Filter by parent task id (subtasks of that task)',
  })
  @IsString()
  @IsOptional()
  parentTaskId?: string;

  @ApiPropertyOptional({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiPropertyOptional({
    description: 'Case-insensitive substring match on title OR description',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Only tasks with dueDate strictly before this date-only YYYY-MM-DD bound (or explicit ISO instant)',
    example: '2026-12-31',
  })
  @IsDateString()
  @IsOptional()
  dueBefore?: string;

  @ApiPropertyOptional({
    description:
      'Only tasks with dueDate at or after this date-only YYYY-MM-DD bound (or explicit ISO instant)',
    example: '2026-01-01',
  })
  @IsDateString()
  @IsOptional()
  dueAfter?: string;

  @ApiPropertyOptional({
    enum: TaskSortBy,
    default: TaskSortBy.createdAt,
    description: 'Column to sort by',
  })
  @IsEnum(TaskSortBy)
  @IsOptional()
  sortBy?: TaskSortBy;

  @ApiPropertyOptional({ enum: TaskSortDir, default: TaskSortDir.desc })
  @IsEnum(TaskSortDir)
  @IsOptional()
  sortDir?: TaskSortDir;

  @ApiPropertyOptional({ type: Number, default: 1, description: '1-based page' })
  @IsOptional()
  page?: string;

  @ApiPropertyOptional({
    type: Number,
    default: 50,
    description: 'Page size (clamped to a max of 100)',
  })
  @IsOptional()
  pageSize?: string;
}
