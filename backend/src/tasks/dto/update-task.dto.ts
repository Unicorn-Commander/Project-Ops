import { PartialType, OmitType, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateTaskDto } from './create-task.dto';

/**
 * Update payload. Every CreateTaskDto field is optional here EXCEPT
 * `parentTaskId`: re-parenting is intentionally not exposed on the generic
 * PATCH path because moving a task between parents needs the same
 * same-project/same-workspace validation AND a subtask-cycle check that the
 * create path performs. Parenting is set once at creation (the validated
 * `createTask` path). Omitting it here keeps an unvalidated re-parent from
 * slipping through `update()`.
 */
export class UpdateTaskDto extends PartialType(OmitType(CreateTaskDto, ['parentTaskId'] as const)) {
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
