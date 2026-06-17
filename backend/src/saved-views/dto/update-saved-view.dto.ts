import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsObject, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Patchable fields of a saved view: name / config / shared. `scope` is
 * intentionally omitted — a view's target surface is fixed at creation (so we
 * do NOT extend PartialType(CreateSavedViewDto), which would let scope change).
 */
export class UpdateSavedViewDto {
  @ApiProperty({ example: 'My active projects', required: false })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @IsOptional()
  name?: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    required: false,
    description:
      'Arbitrary list configuration (filters / sort / visible columns). Must be a JSON object; size-capped server-side.',
  })
  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  shared?: boolean;
}
