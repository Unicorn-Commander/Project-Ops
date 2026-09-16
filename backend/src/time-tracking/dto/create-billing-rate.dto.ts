import { IsString, IsOptional, IsNumber, IsEnum, IsDateString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { RateScopeType, TaskType, UserRole } from '@prisma/client';

export class CreateBillingRateDto {
  @ApiProperty({ enum: RateScopeType, example: RateScopeType.PROJECT })
  @IsEnum(RateScopeType)
  scopeType: RateScopeType;

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
  contactId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  taskId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  organizationId?: string;

  @ApiProperty({ required: false, enum: TaskType })
  @IsEnum(TaskType)
  @IsOptional()
  taskType?: TaskType;

  @ApiProperty({ required: false, enum: UserRole })
  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @ApiProperty({ example: 150.0 })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  billRate: number;

  @ApiProperty({
    required: false,
    example: 65.0,
    description: 'Internal cost rate — never shown to CLIENT.',
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  costRate?: number;

  @ApiProperty({ required: false, default: 'USD' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ required: false, example: '2026-01-01T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  effectiveFrom?: string;

  @ApiProperty({ required: false, example: '2026-12-31T00:00:00Z' })
  @IsDateString()
  @IsOptional()
  effectiveTo?: string;
}
