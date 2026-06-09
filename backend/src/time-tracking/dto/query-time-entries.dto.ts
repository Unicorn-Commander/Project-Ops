import { IsString, IsOptional, IsBoolean, IsEnum, IsDateString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ApprovalStatus } from '@prisma/client';

export class QueryTimeEntriesDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  taskId?: string;

  @ApiProperty({ required: false, description: 'Start of range (inclusive), ISO date.' })
  @IsDateString()
  @IsOptional()
  from?: string;

  @ApiProperty({ required: false, description: 'End of range (inclusive), ISO date.' })
  @IsDateString()
  @IsOptional()
  to?: string;

  @ApiProperty({ required: false })
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  billable?: boolean;

  @ApiProperty({ required: false })
  @IsBoolean()
  @Type(() => Boolean)
  @IsOptional()
  billed?: boolean;

  @ApiProperty({ required: false, enum: ApprovalStatus })
  @IsEnum(ApprovalStatus)
  @IsOptional()
  approvalStatus?: ApprovalStatus;

  @ApiProperty({ required: false, default: 1 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page?: number;

  @ApiProperty({ required: false, default: 50 })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  limit?: number;
}
