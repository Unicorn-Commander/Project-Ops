import { IsOptional, IsString, IsIn, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus, ProjectPriority } from '@prisma/client';

/**
 * Sortable project columns for GET /projects. A closed allow-list so a caller
 * can't order by an arbitrary (or relational / un-indexed) column.
 */
export const PROJECT_SORT_FIELDS = ['createdAt', 'title', 'status', 'priority', 'dueDate'] as const;
export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * Query DTO for the project list. Carries pagination, the existing
 * status/priority/assignedToId filters, and the additive search/sort controls.
 * Validated + coerced at the edge so the controller just builds the where/orderBy.
 */
export class ListProjectsDto {
  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({
    type: Number,
    default: 20,
    description: 'Page size (clamped to a max of 1000 for the project list).',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @ApiPropertyOptional({ enum: ProjectPriority })
  @IsEnum(ProjectPriority)
  @IsOptional()
  priority?: ProjectPriority;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Case-insensitive match on title / clientName / projectNumber.',
  })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({
    enum: PROJECT_SORT_FIELDS,
    default: 'createdAt',
    description: 'Column to sort by.',
  })
  @IsIn(PROJECT_SORT_FIELDS)
  @IsOptional()
  sortBy?: ProjectSortField;

  @ApiPropertyOptional({ enum: SORT_DIRECTIONS, default: 'desc' })
  @IsIn(SORT_DIRECTIONS)
  @IsOptional()
  sortDir?: SortDirection;
}
