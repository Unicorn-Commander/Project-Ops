import { IsBoolean, IsEnum, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus } from '@prisma/client';

export class UpdateTaskStatusDto {
  @ApiProperty({
    enum: TaskStatus,
    example: TaskStatus.COMPLETED,
  })
  @IsEnum(TaskStatus)
  @IsNotEmpty()
  status: TaskStatus;

  @ApiPropertyOptional({
    description:
      'Complete a task despite open FINISH_TO_START blockers. Only workspace OWNER, ADMIN, or MANAGER may use this override.',
  })
  @IsBoolean()
  @IsOptional()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Alias for force. Only workspace OWNER, ADMIN, or MANAGER may use this override.',
  })
  @IsBoolean()
  @IsOptional()
  overrideDependencies?: boolean;
}

/** Optional override flags for the dedicated POST /tasks/:id/complete route. */
export class TaskCompletionOverrideDto {
  @ApiPropertyOptional({
    description:
      'Complete a task despite open FINISH_TO_START blockers. Only workspace OWNER, ADMIN, or MANAGER may use this override.',
  })
  @IsBoolean()
  @IsOptional()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Alias for force. Only workspace OWNER, ADMIN, or MANAGER may use this override.',
  })
  @IsBoolean()
  @IsOptional()
  overrideDependencies?: boolean;
}
