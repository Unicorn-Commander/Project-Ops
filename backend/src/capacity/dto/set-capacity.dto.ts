import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for `PATCH /capacity/users/:userId` — set a user's weekly working-hours
 * budget. Bounded to 0–168 (a week has 168 hours; 0 means "no committed
 * capacity", e.g. a user on leave). Validation is enforced by the global
 * ValidationPipe.
 */
export class SetCapacityDto {
  @ApiProperty({
    description: "The user's weekly capacity in hours (0–168).",
    minimum: 0,
    maximum: 168,
    example: 40,
  })
  @IsInt()
  @Min(0)
  @Max(168)
  weeklyCapacityHours: number;
}
