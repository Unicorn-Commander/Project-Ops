import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsDateString,
  IsObject,
  IsNumber,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskStatus, TaskPriority, TaskType } from '@prisma/client';

export class CreateTaskDto {
  @ApiProperty({ example: 'uuid-of-project' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ example: 'Review design mockups' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({
    example: 'Review the latest design mockups and provide feedback',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    enum: TaskType,
    example: TaskType.TASK,
    required: false,
  })
  @IsEnum(TaskType)
  @IsOptional()
  type?: TaskType;

  @ApiProperty({
    enum: TaskStatus,
    example: TaskStatus.PENDING,
    required: false,
  })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiProperty({
    enum: TaskPriority,
    example: TaskPriority.HIGH,
    required: false,
  })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiProperty({
    example: '2025-10-15T00:00:00Z',
    required: false,
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiProperty({
    example: 'uuid-of-user',
    required: false,
  })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiProperty({
    description:
      'Parent task id, to create this task as a subtask. The parent must be in the same workspace AND the same project.',
    example: 'uuid-of-parent-task',
    required: false,
  })
  @IsString()
  @IsOptional()
  parentTaskId?: string;

  @ApiProperty({
    example: {
      documentTypes: ['mockup', 'wireframe'],
      checklistItems: ['Review layout', 'Check responsiveness'],
    },
    required: false,
    type: 'object',
  })
  @IsObject()
  @IsOptional()
  metadata?: any;

  @ApiProperty({
    description:
      'Recurrence rule (RRULE subset: FREQ=DAILY|WEEKLY|MONTHLY with optional INTERVAL). When set, this task is a recurrence TEMPLATE and a daily cron materializes its next instance.',
    example: 'FREQ=WEEKLY;INTERVAL=1',
    required: false,
  })
  @IsString()
  @IsOptional()
  recurrenceRule?: string;

  @ApiProperty({
    description: 'Effort estimate in hours (used by capacity planning).',
    example: 4.5,
    required: false,
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  estimatedHours?: number;

  @ApiProperty({
    description:
      'Custom-field VALUES for this task, keyed by the workspace TASK field key. Validated + normalized against the workspace custom-field definitions, then merged into metadata.customFields.',
    example: { priority_score: 8, client_tier: 'gold' },
    required: false,
    type: 'object',
  })
  @IsObject()
  @IsOptional()
  customFields?: Record<string, any>;
}
