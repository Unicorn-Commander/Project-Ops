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
import { CustomFieldType } from '@prisma/client';

/**
 * Patchable fields of a custom-field definition: label / type / options /
 * required / position. `key` and `entity` are intentionally omitted — a field's
 * identity (key) and target entity are fixed at creation (so we do NOT extend
 * PartialType(CreateCustomFieldDto), which would let those change).
 */
export class UpdateCustomFieldDto {
  @ApiProperty({ required: false, example: 'Priority Tier' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @IsOptional()
  label?: string;

  @ApiProperty({ required: false, enum: CustomFieldType, example: CustomFieldType.SELECT })
  @IsEnum(CustomFieldType)
  @IsOptional()
  type?: CustomFieldType;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['Low', 'Medium', 'High'],
    description: 'Allowed option values. Required + non-empty when the (resulting) type is SELECT / MULTISELECT.',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  options?: string[];

  @ApiProperty({ required: false, example: true })
  @IsBoolean()
  @IsOptional()
  required?: boolean;

  @ApiProperty({ required: false, example: 1 })
  @IsInt()
  @Min(0)
  @IsOptional()
  position?: number;
}
