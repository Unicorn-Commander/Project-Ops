import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsEnum,
  IsInt,
  IsArray,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CustomFieldEntity, CustomFieldType } from '@prisma/client';
import { MAX_KEY_LENGTH } from '../custom-fields.constants';

/**
 * Create a custom-field DEFINITION. `key` is optional — when omitted it is
 * auto-derived from `label` (see CustomFieldsService.create). `options` is only
 * meaningful for SELECT / MULTISELECT and is required + non-empty for those
 * (enforced in the service, which also knows the type). `entity` and `key` are
 * fixed at creation; PATCH cannot change them.
 */
export class CreateCustomFieldDto {
  @ApiProperty({ enum: CustomFieldEntity, example: CustomFieldEntity.TASK })
  @IsEnum(CustomFieldEntity)
  entity: CustomFieldEntity;

  @ApiProperty({
    required: false,
    example: 'priority_tier',
    description:
      'Stable slug identity (lowercase letter, then lowercase alnum/underscore). Auto-derived from `label` when omitted.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(MAX_KEY_LENGTH)
  key?: string;

  @ApiProperty({ example: 'Priority Tier' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  label: string;

  @ApiProperty({ enum: CustomFieldType, example: CustomFieldType.SELECT })
  @IsEnum(CustomFieldType)
  type: CustomFieldType;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['Low', 'Medium', 'High'],
    description: 'Allowed option values. Required + non-empty for SELECT / MULTISELECT.',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  options?: string[];

  @ApiProperty({ required: false, example: false })
  @IsBoolean()
  @IsOptional()
  required?: boolean;

  @ApiProperty({ required: false, example: 0, description: 'Sort order within the entity.' })
  @IsInt()
  @Min(0)
  @IsOptional()
  position?: number;
}
