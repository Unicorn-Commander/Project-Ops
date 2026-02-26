import { IsString, IsNotEmpty, IsEnum, IsOptional, IsInt, IsEmail, IsDateString, IsObject, IsNumber, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProjectStatus, ProjectPriority, PaymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class CreateProjectDto {
  @ApiProperty({ example: 'Website Redesign Q1 2026' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty({ example: 'Full redesign of the company website', required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ enum: ProjectStatus, example: ProjectStatus.NEW, required: false })
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @ApiProperty({ enum: ProjectPriority, example: ProjectPriority.MEDIUM, required: false })
  @IsEnum(ProjectPriority)
  @IsOptional()
  priority?: ProjectPriority;

  @ApiProperty({ example: 'uuid-of-contact', required: false })
  @IsString()
  @IsOptional()
  contactId?: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  clientName: string;

  @ApiProperty({ example: 'john.doe@example.com', required: false })
  @IsEmail()
  @IsOptional()
  clientEmail?: string;

  @ApiProperty({ example: '+1234567890', required: false })
  @IsString()
  @IsOptional()
  clientPhone?: string;

  @ApiProperty({ example: '2026-04-15T00:00:00Z', required: false })
  @IsDateString()
  @IsOptional()
  dueDate?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  assignedToId?: string;

  @ApiProperty({ required: false, type: 'object' })
  @IsObject()
  @IsOptional()
  metadata?: any;

  @ApiProperty({ example: 'Development', required: false })
  @IsString()
  @IsOptional()
  category?: string;

  @ApiProperty({ required: false, type: 'object', description: 'Tags or labels for the project' })
  @IsOptional()
  tags?: any;

  // Billing & Invoicing Fields
  @ApiProperty({ example: 'INV-2026-001', required: false })
  @IsString()
  @IsOptional()
  invoiceNumber?: string;

  @ApiProperty({ example: 2500.00, required: false })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  billingAmount?: number;

  @ApiProperty({ example: 0.00, required: false })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  amountPaid?: number;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.UNPAID, required: false })
  @IsEnum(PaymentStatus)
  @IsOptional()
  paymentStatus?: PaymentStatus;

  @ApiProperty({ example: '2026-01-15T00:00:00Z', required: false })
  @IsDateString()
  @IsOptional()
  billingDate?: string;

  @ApiProperty({ example: '2026-02-15T00:00:00Z', required: false })
  @IsDateString()
  @IsOptional()
  paymentDueDate?: string;

  @ApiProperty({ example: '2026-02-10T00:00:00Z', required: false })
  @IsDateString()
  @IsOptional()
  paymentReceivedDate?: string;

  @ApiProperty({ example: 'Payment via check #1234', required: false })
  @IsString()
  @IsOptional()
  billingNotes?: string;

  // Project type (stored in metadata, not a direct field)
  @ApiProperty({ example: 'DEVELOPMENT', required: false })
  @IsString()
  @IsOptional()
  projectType?: string;
}
