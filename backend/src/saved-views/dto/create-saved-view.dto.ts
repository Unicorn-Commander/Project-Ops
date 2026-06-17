import {
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  IsObject,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SAVED_VIEW_SCOPES, SavedViewScope } from '../saved-views.constants';

export class CreateSavedViewDto {
  @ApiProperty({
    enum: SAVED_VIEW_SCOPES,
    example: 'projects',
    description: 'The list surface this view targets (known-string allow-list).',
  })
  @IsString()
  @IsIn(SAVED_VIEW_SCOPES)
  scope: SavedViewScope;

  @ApiProperty({ example: 'My active projects' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Arbitrary list configuration (filters / sort / visible columns). Must be a JSON object; size-capped server-side.',
    example: {
      filters: { status: 'IN_PROGRESS' },
      sort: { sortBy: 'dueDate', sortDir: 'asc' },
      columns: ['title', 'status', 'dueDate'],
    },
  })
  @IsObject()
  config: Record<string, any>;

  @ApiProperty({
    example: false,
    required: false,
    description: 'When true, other members of the same workspace can see this view.',
  })
  @IsBoolean()
  @IsOptional()
  shared?: boolean;
}
