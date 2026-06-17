import { IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TaskDependencyType } from '@prisma/client';

/**
 * Direction of a dependency relative to the task in the URL (`:id`).
 *
 * Semantics (matching the schema): a TaskDependency edge means the SUCCESSOR
 * depends on the PREDECESSOR.
 *
 *  - DEPENDS_ON  → the URL task is the SUCCESSOR and `taskId` is the
 *                  PREDECESSOR. i.e. "this task depends on `taskId`".
 *  - BLOCKS      → the URL task is the PREDECESSOR and `taskId` is the
 *                  SUCCESSOR. i.e. "this task blocks `taskId`".
 */
export enum DependencyDirection {
  DEPENDS_ON = 'DEPENDS_ON',
  BLOCKS = 'BLOCKS',
}

export class CreateTaskDependencyDto {
  @ApiProperty({
    description: 'The id of the OTHER task the dependency links to.',
    example: 'uuid-of-other-task',
  })
  @IsString()
  @IsNotEmpty()
  taskId: string;

  @ApiProperty({
    enum: DependencyDirection,
    description:
      'DEPENDS_ON: the URL task depends on `taskId`. BLOCKS: the URL task blocks `taskId`.',
    example: DependencyDirection.DEPENDS_ON,
    default: DependencyDirection.DEPENDS_ON,
    required: false,
  })
  @IsEnum(DependencyDirection)
  @IsOptional()
  direction?: DependencyDirection;

  @ApiProperty({
    enum: TaskDependencyType,
    example: TaskDependencyType.FINISH_TO_START,
    default: TaskDependencyType.FINISH_TO_START,
    required: false,
  })
  @IsEnum(TaskDependencyType)
  @IsOptional()
  type?: TaskDependencyType;
}
