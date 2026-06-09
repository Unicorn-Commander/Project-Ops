import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TimeEntrySource } from '@prisma/client';

/**
 * Manual time entry. Provide either (startedAt + endedAt) or durationMinutes.
 * If only startedAt + durationMinutes are given, endedAt is derived.
 */
export class CreateTimeEntryDto {
  @ApiProperty({ required: false, description: 'Project id. Required unless taskId is given.' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ required: false, description: 'Task id; its project is used automatically.' })
  @IsString()
  @IsOptional()
  taskId?: string;

  @ApiProperty({ required: false, example: 'Client call + notes' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false, example: '2026-06-03T14:00:00Z' })
  @IsDateString()
  @IsOptional()
  startedAt?: string;

  @ApiProperty({ required: false, example: '2026-06-03T15:30:00Z' })
  @IsDateString()
  @IsOptional()
  endedAt?: string;

  @ApiProperty({ required: false, example: 90, description: 'Duration in minutes (alternative to endedAt).' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  durationMinutes?: number;

  @ApiProperty({ required: false, description: 'Defaults to the task/project billable policy.' })
  @IsBoolean()
  @IsOptional()
  billable?: boolean;

  @ApiProperty({ required: false, enum: TimeEntrySource, default: TimeEntrySource.MANUAL })
  @IsEnum(TimeEntrySource)
  @IsOptional()
  source?: TimeEntrySource;
}
