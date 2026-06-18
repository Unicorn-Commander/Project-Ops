import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { CustomFieldEntity } from '@prisma/client';

/**
 * Query for GET /custom-fields. `entity` is required so a caller fetches the
 * definitions for exactly one entity kind (the column is indexed
 * `[workspaceId, entity]`).
 */
export class ListCustomFieldsDto {
  @ApiProperty({ enum: CustomFieldEntity, example: CustomFieldEntity.TASK })
  @IsEnum(CustomFieldEntity)
  entity: CustomFieldEntity;
}
