import { IsString, IsOptional, IsArray, IsDateString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Submit a weekly timesheet. Defaults to the week containing periodStart (or
 * the current week if omitted). All of the user's DRAFT entries in that week
 * are grouped into a TimesheetPeriod and moved to SUBMITTED.
 */
export class SubmitTimesheetDto {
  @ApiProperty({ required: false, description: 'Any date inside the target week (ISO). Defaults to now.' })
  @IsDateString()
  @IsOptional()
  periodStart?: string;
}

/** Approve a whole submitted period, or specific entries within it. */
export class ApproveTimeDto {
  @ApiProperty({ required: false, description: 'Approve every submitted entry in this period.' })
  @IsString()
  @IsOptional()
  timesheetPeriodId?: string;

  @ApiProperty({ required: false, type: [String], description: 'Approve just these entries.' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  timeEntryIds?: string[];
}

/** Reject a whole submitted period, or specific entries, with a reason. */
export class RejectTimeDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  timesheetPeriodId?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  timeEntryIds?: string[];

  @ApiProperty({ example: 'Please split the 6h block into per-task entries.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
