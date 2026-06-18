import { IsDateString, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params for the capacity views (`GET /capacity`, `GET /capacity/me`).
 *
 * `from`/`to` bound the planning window (inclusive). Both optional: when either
 * is omitted the service defaults to the CURRENT WEEK (Mon 00:00 → Sun 23:59:59
 * of the server's local week — see CapacityService.resolveWindow). Server-time
 * is correct here (this is the backend); the SSR `new Date()` caveat in the
 * brief is a frontend concern only.
 */
export class CapacityWindowDto {
  @ApiPropertyOptional({
    description:
      'Window start (inclusive) as an ISO date/timestamp. Defaults to the start of the current week.',
    example: '2026-06-15T00:00:00Z',
  })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    description:
      'Window end (inclusive) as an ISO date/timestamp. Defaults to the end of the current week.',
    example: '2026-06-21T23:59:59Z',
  })
  @IsDateString()
  @IsOptional()
  to?: string;
}
