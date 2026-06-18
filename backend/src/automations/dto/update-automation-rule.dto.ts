import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { IsAutomationActionArray, IsAutomationConditionArray } from './automation-validation';

/**
 * Partial update of an automation rule. Every field is optional; only the
 * fields present are changed. `actions`/`conditions`, when present, are
 * re-validated to the same shapes as on create. `trigger` may be changed.
 */
export class UpdateAutomationRuleDto {
  @ApiPropertyOptional({ example: 'Auto-assign urgent tasks to lead' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiPropertyOptional({ enum: AutomationTrigger })
  @IsEnum(AutomationTrigger)
  @IsOptional()
  trigger?: AutomationTrigger;

  @ApiPropertyOptional({
    description: 'Array of conditions { field, op, value }.',
    example: [{ field: 'priority', op: 'eq', value: 'URGENT' }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Validate(IsAutomationConditionArray)
  conditions?: unknown[];

  @ApiPropertyOptional({
    description: 'Array of actions { type, params }.',
    example: [{ type: 'set_status', params: { status: 'IN_PROGRESS' } }],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Validate(IsAutomationActionArray)
  actions?: unknown[];
}
