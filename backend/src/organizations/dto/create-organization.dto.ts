import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDecimal, IsInt, IsBoolean, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OrgType } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateOrganizationDto {
  @ApiProperty({ example: 'ABC Tax Services' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: OrgType, example: OrgType.CPA_FIRM })
  @IsEnum(OrgType)
  type: OrgType;

  @ApiProperty({ example: 'uuid-of-parent-organization', required: false })
  @IsString()
  @IsOptional()
  parentOrgId?: string;

  @ApiProperty({ example: '12-3456789', required: false })
  @IsString()
  @IsOptional()
  taxId?: string;

  @ApiProperty({ example: 'Technology', required: false })
  @IsString()
  @IsOptional()
  industry?: string;

  @ApiProperty({ example: 'https://www.example.com', required: false })
  @IsUrl()
  @IsOptional()
  website?: string;

  @ApiProperty({ example: 5000000.00, required: false })
  @IsOptional()
  @Type(() => Number)
  annualRevenue?: number;

  @ApiProperty({ example: 50, required: false })
  @IsInt()
  @IsOptional()
  employeeCount?: number;

  @ApiProperty({ example: '123 Main Street', required: false })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({ example: 'New York', required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ example: 'NY', required: false })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiProperty({ example: '10001', required: false })
  @IsString()
  @IsOptional()
  zipCode?: string;

  @ApiProperty({ example: 'USA', required: false })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiProperty({ example: 'Important client notes', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ example: true, required: false })
  @IsBoolean()
  @IsOptional()
  portalAccessEnabled?: boolean;
}
