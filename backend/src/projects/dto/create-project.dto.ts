import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsEmail,
  IsDateString,
  IsObject,
  IsNumber,
  Min,
} from 'class-validator';
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

  @ApiProperty({ example: 2500.0, required: false })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  billingAmount?: number;

  @ApiProperty({
    example: 2500,
    required: false,
    description:
      'Flat fee for the whole project. Billed once, due on receipt, when no task on the project has its own flat fee. Distinct from billingAmount, which mirrors the last invoice total.',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  flatFeeAmount?: number;

  @ApiProperty({ required: false, description: 'Customer-Ops customer id this project bills.' })
  @IsString()
  @IsOptional()
  customerOpsCustomerId?: string;

  @ApiProperty({ required: false, description: 'Contact-Ops contact id for the billed party.' })
  @IsString()
  @IsOptional()
  contactOpsContactId?: string;

  @ApiProperty({ example: 0.0, required: false })
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

  // Recurrence (Wave 2). A minimal RRULE — FREQ=DAILY|WEEKLY|MONTHLY with an
  // optional INTERVAL (e.g. "FREQ=MONTHLY;INTERVAL=1"). Setting this on a project
  // with no recurrenceParentId marks it a TEMPLATE: a daily cron materializes the
  // next instance from it. Validated minimally here; the engine ignores
  // unsupported parts. See recurrence.util.ts.
  @ApiProperty({
    example: 'FREQ=MONTHLY;INTERVAL=1',
    required: false,
    description: 'Minimal RRULE (FREQ=DAILY|WEEKLY|MONTHLY + optional INTERVAL).',
  })
  @IsString()
  @IsOptional()
  recurrenceRule?: string;

  // Custom-field VALUES for this project (Wave 2). A free-form map keyed by the
  // workspace's PROJECT field definitions; validated + normalized by the
  // custom-fields service and merged into metadata.customFields on write.
  @ApiProperty({
    required: false,
    type: 'object',
    description: 'Custom-field values, validated against the workspace PROJECT field set.',
  })
  @IsObject()
  @IsOptional()
  customFields?: Record<string, any>;
}
