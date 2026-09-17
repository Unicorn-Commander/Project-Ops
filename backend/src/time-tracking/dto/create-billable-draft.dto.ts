import { IsString, IsOptional, IsEnum, IsDateString, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum BillableGroupBy {
  TASK = 'TASK',
  ROLE = 'ROLE',
  DAY = 'DAY',
  NONE = 'NONE',
}

/**
 * Assemble a billable draft from APPROVED, billable, unbilled time entries and
 * (when entitled + BILLABLE_ROLLUP_LIVE) create the invoice in Accounting-Ops.
 * Scope by project or by client (contact); optionally restrict to a period.
 */
export class CreateBillableDraftDto {
  @ApiProperty({ required: false, description: 'Roll up a single project.' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ required: false, description: "Roll up all of a client/contact's projects." })
  @IsString()
  @IsOptional()
  clientId?: string;

  @ApiProperty({ required: false, description: 'Only entries on/after this date (ISO).' })
  @IsDateString()
  @IsOptional()
  periodStart?: string;

  @ApiProperty({ required: false, description: 'Only entries on/before this date (ISO).' })
  @IsDateString()
  @IsOptional()
  periodEnd?: string;

  @ApiProperty({ required: false, enum: BillableGroupBy, default: BillableGroupBy.TASK })
  @IsEnum(BillableGroupBy)
  @IsOptional()
  groupBy?: BillableGroupBy;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Ask AO to issue (status=sent) instead of draft.',
  })
  @IsBoolean()
  @IsOptional()
  autoSend?: boolean;
}
