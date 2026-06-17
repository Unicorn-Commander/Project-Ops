import { PartialType, OmitType } from '@nestjs/swagger';
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
export class UpdateTaskDto extends PartialType(
  OmitType(CreateTaskDto, ['parentTaskId'] as const),
) {}
