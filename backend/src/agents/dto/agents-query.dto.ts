import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AgentVia } from '@prisma/client';

/**
 * Query params for the agent views.
 *
 * `from`/`to` bound the reporting window (inclusive). Both optional: when either
 * is omitted the service defaults to the TRAILING 30 DAYS (see
 * AgentEventsService.resolveWindow). Server-time is correct here (this is the
 * backend). All four DTOs share the window; the activity feed adds paging +
 * filters and `/usage` is window-only.
 */
export class AgentsWindowDto {
  @ApiPropertyOptional({
    description: 'Window start (inclusive) as an ISO date/timestamp. Defaults to 30 days ago.',
    example: '2026-05-20T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    description: 'Window end (inclusive) as an ISO date/timestamp. Defaults to now.',
    example: '2026-06-19T23:59:59Z',
  })
  @IsDateString()
  @IsOptional()
  to?: string;
}

/**
 * Query params for `GET /agents/activity` — the paged activity feed.
 *
 * NOTE on paging: this stack's global ValidationPipe + `@Type(() => Number)`
 * coercion is paired with `DefaultValuePipe` at the controller for limit/offset.
 * We DON'T use `ParseIntPipe({ optional: true })` on a missing query param —
 * it 400s on absence in this NestJS version. So limit/offset are optional here
 * and defaulted in the controller.
 */
export class AgentActivityQueryDto extends AgentsWindowDto {
  @ApiPropertyOptional({ description: 'Filter to one agent by its stable actorKey.' })
  @IsString()
  @IsOptional()
  actorKey?: string;

  @ApiPropertyOptional({ description: 'Filter to one project id.' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({ enum: AgentVia, description: 'Filter to one channel (MCP/API/…).'.trim() })
  @IsOptional()
  via?: AgentVia;

  @ApiPropertyOptional({
    description: 'Page size (1–200). Defaulted at the controller.',
    example: 50,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({
    description: 'Row offset (>= 0). Defaulted at the controller.',
    example: 0,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}
