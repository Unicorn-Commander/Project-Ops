import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum CloneDueDateMode {
  KEEP = 'keep',
  SHIFT = 'shift',
  CLEAR = 'clear',
}

export class CloneProjectDto {
  @ApiProperty({ required: false, description: 'Workspace to receive the clone.' })
  @IsString()
  @IsOptional()
  targetWorkspaceId?: string;

  @ApiProperty({ required: false, description: 'Title for the clone; defaults to "(copy)".' })
  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  includeTasks?: boolean;

  @ApiProperty({ required: false, default: true })
  @IsBoolean()
  @IsOptional()
  resetStatus?: boolean;

  @ApiProperty({ enum: CloneDueDateMode, required: false, default: CloneDueDateMode.SHIFT })
  @IsEnum(CloneDueDateMode)
  @IsOptional()
  dueDateMode?: CloneDueDateMode;

  @ApiProperty({ required: false, example: '2026-11-16' })
  @IsDateString()
  @IsOptional()
  startDate?: string;
}
