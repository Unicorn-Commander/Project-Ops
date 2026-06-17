import { IsBooleanString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params for `GET /notifications`.
 *
 * `page`/`limit` are coerced + bounded (limit defaults to 20, hard-capped at
 * 100 via clampLimit at the service edge); `unreadOnly` is a string boolean
 * (`?unreadOnly=true`) because query params arrive as strings.
 */
export class QueryNotificationsDto {
  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: 'true',
    description: 'When "true", return only unread notifications.',
  })
  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;
}
