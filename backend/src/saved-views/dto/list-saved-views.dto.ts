import { IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SAVED_VIEW_SCOPES, SavedViewScope } from '../saved-views.constants';

/**
 * Query for GET /saved-views. `scope` is required so a caller fetches the views
 * for exactly one list surface (the column is indexed `[workspaceId, scope]`).
 */
export class ListSavedViewsDto {
  @ApiProperty({
    enum: SAVED_VIEW_SCOPES,
    example: 'projects',
    description: 'Return saved views for this list surface.',
  })
  @IsString()
  @IsIn(SAVED_VIEW_SCOPES)
  scope: SavedViewScope;
}
