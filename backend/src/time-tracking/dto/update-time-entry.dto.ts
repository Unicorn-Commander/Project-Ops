import { IsString, IsOptional, IsBoolean, IsNumber, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Patch a DRAFT, unlocked, unbilled time entry. Only fields supplied are
 * changed. Locked or billed entries are immutable (service rejects).
 */
export class UpdateTimeEntryDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  taskId?: string;

  @ApiProperty({ required: false, example: '2026-06-03T14:00:00Z' })
  @IsDateString()
  @IsOptional()
  startedAt?: string;

  @ApiProperty({ required: false, example: '2026-06-03T15:30:00Z' })
  @IsDateString()
  @IsOptional()
  endedAt?: string;

  @ApiProperty({ required: false, example: 90 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  durationMinutes?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  billable?: boolean;
}
