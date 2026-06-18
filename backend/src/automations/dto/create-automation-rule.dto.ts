import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AutomationTrigger } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Validate,
} from 'class-validator';
import { ACTION_TYPES, CONDITION_OPS } from '../automation.types';
import { IsAutomationActionArray, IsAutomationConditionArray } from './automation-validation';

/**
 * Create an automation rule. `actions` is required and must be a non-empty
 * array of `{type, params}`; `conditions` is optional and, when present, must be
 * an array of `{field, op, value}`. Both array shapes are enforced by custom
 * class-validators (see automation-validation.ts) so a malformed body is a 400,
 * never a runtime engine crash.
 */
export class CreateAutomationRuleDto {
  @ApiProperty({ example: 'Auto-assign urgent tasks to lead' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ description: 'Defaults to true.', example: true })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiProperty({ enum: AutomationTrigger, example: AutomationTrigger.TASK_CREATED })
  @IsEnum(AutomationTrigger)
  trigger: AutomationTrigger;

  @ApiPropertyOptional({
    description: `Array of conditions { field, op, value }. op ∈ [${CONDITION_OPS.join(', ')}]. All must match (AND).`,
    example: [{ field: 'priority', op: 'eq', value: 'URGENT' }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Validate(IsAutomationConditionArray)
  conditions?: unknown[];

  @ApiProperty({
    description: `Array of actions { type, params }. type ∈ [${ACTION_TYPES.join(', ')}].`,
    example: [{ type: 'assign_task', params: { userId: 'uuid-of-user' } }],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @Validate(IsAutomationActionArray)
  actions: unknown[];
}
