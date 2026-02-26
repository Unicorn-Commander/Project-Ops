import { IsString, IsEmail, IsOptional, IsBoolean, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateContactDto {
  @ApiProperty({
    description: 'Contact first name',
    example: 'John'
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName: string;

  @ApiProperty({
    description: 'Contact last name',
    example: 'Smith'
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName: string;

  @ApiProperty({
    description: 'Contact email address',
    example: 'john.smith@example.com'
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    description: 'Contact phone number',
    example: '+1 (555) 123-4567'
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({
    description: 'Company name for business contacts',
    example: 'Smith Enterprises Inc.'
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @ApiPropertyOptional({
    description: 'Street address',
    example: '123 Main Street, Suite 100'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    description: 'City',
    example: 'New York'
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({
    description: 'State or province',
    example: 'NY'
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  state?: string;

  @ApiPropertyOptional({
    description: 'ZIP or postal code',
    example: '10001'
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zipCode?: string;

  @ApiPropertyOptional({
    description: 'Tax ID (SSN or EIN)',
    example: '12-3456789'
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  taxId?: string;

  @ApiPropertyOptional({
    description: 'Additional notes about the contact',
    example: 'Prefers email communication. Has complex multi-state tax situation.'
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    description: 'Whether this contact is currently active',
    default: true
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
