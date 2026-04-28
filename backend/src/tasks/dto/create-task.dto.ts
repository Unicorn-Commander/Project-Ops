import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString, IsObject } from 'class-validator';
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
    required: false
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    enum: TaskType,
    example: TaskType.TASK,
    required: false
  })
  @IsEnum(TaskType)
  @IsOptional()
  type?: TaskType;

  @ApiProperty({
    enum: TaskStatus,
    example: TaskStatus.PENDING,
    required: false
  })
  @IsEnum(TaskStatus)
  @IsOptional()
  status?: TaskStatus;

  @ApiProperty({
    enum: TaskPriority,
    example: TaskPriority.HIGH,
    required: false
  })
  @IsEnum(TaskPriority)
  @IsOptional()
  priority?: TaskPriority;

  @ApiProperty({
    example: '2025-10-15T00:00:00Z',
    required: false
  })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiProperty({
    example: 'uuid-of-user',
    required: false
  })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiProperty({
    example: {
      documentTypes: ['mockup', 'wireframe'],
      checklistItems: ['Review layout', 'Check responsiveness'],
    },
    required: false,
    type: 'object'
  })
  @IsObject()
  @IsOptional()
  metadata?: any;
}
