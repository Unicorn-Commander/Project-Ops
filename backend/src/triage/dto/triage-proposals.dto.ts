import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TriageAction {
  APPROVE = 'approve',
  REJECT = 'reject',
}

export enum TriageReasonPreset {
  STALE = 'stale',
  DUPLICATE = 'duplicate',
  NOT_OURS = 'not_ours',
  HANDLED_ELSEWHERE = 'handled_elsewhere',
  VAGUE = 'vague',
  PERSONAL = 'personal',
}

export const TRIAGE_REASON_PRESETS = Object.values(TriageReasonPreset) as [
  TriageReasonPreset,
  ...TriageReasonPreset[],
];

export const TRIAGE_LIST_STATUS_VALUES = [
  'PENDING',
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'APPLIED',
  'DROPPED',
] as const;

export type TriageListStatus = (typeof TRIAGE_LIST_STATUS_VALUES)[number];

export class TriageDecisionDto {
  @ApiProperty({ description: 'Triage proposal UUID.' })
  @IsUUID()
  @IsNotEmpty()
  proposalId: string;

  @ApiProperty({ enum: TriageAction })
  @IsEnum(TriageAction)
  action: TriageAction;

  @ApiPropertyOptional({ description: 'Override project UUID when approving.' })
  @IsUUID()
  @IsOptional()
  targetProjectId?: string;

  @ApiPropertyOptional({
    enum: TriageReasonPreset,
    description: 'Optional rejection reason preset.',
  })
  @IsEnum(TriageReasonPreset)
  @IsOptional()
  reasonPreset?: TriageReasonPreset;

  @ApiPropertyOptional({ description: 'Optional free-form rejection note.' })
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: 'Existing task UUID when rejecting as a duplicate.' })
  @IsUUID()
  @IsOptional()
  duplicateOfTaskId?: string;
}

export class BulkTriageProposalsDto {
  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 200,
    description: 'Proposal UUIDs to process. Each id receives an independent result.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  proposalIds: string[];

  @ApiProperty({ enum: TriageAction })
  @IsEnum(TriageAction)
  action: TriageAction;

  @ApiPropertyOptional({ description: 'Project UUID applied to every approval.' })
  @IsUUID()
  @IsOptional()
  targetProjectId?: string;

  @ApiPropertyOptional({
    enum: TriageReasonPreset,
    description:
      'Optional rejection preset. Valid values: stale, duplicate, not_ours, handled_elsewhere, vague, personal.',
  })
  @IsEnum(TriageReasonPreset)
  @IsOptional()
  reasonPreset?: TriageReasonPreset;

  @ApiPropertyOptional({ description: 'Optional free-form rejection note.' })
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: 'Existing task UUID when rejecting as a duplicate.' })
  @IsUUID()
  @IsOptional()
  duplicateOfTaskId?: string;
}

export class ApproveTriageProposalDto {
  @ApiPropertyOptional({ description: 'Override project UUID.' })
  @IsUUID()
  @IsOptional()
  targetProjectId?: string;
}

export class RejectTriageProposalDto {
  @ApiPropertyOptional({
    enum: TriageReasonPreset,
    description:
      'Optional rejection preset. Valid values: stale, duplicate, not_ours, handled_elsewhere, vague, personal.',
  })
  @IsEnum(TriageReasonPreset)
  @IsOptional()
  reasonPreset?: TriageReasonPreset;

  @ApiPropertyOptional({ description: 'Optional free-form rejection note.' })
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({ description: 'Existing task UUID when rejecting as a duplicate.' })
  @IsUUID()
  @IsOptional()
  duplicateOfTaskId?: string;
}

export class ListTriageProposalsDto {
  @ApiPropertyOptional({
    enum: TRIAGE_LIST_STATUS_VALUES,
    description: 'Status filter. PENDING is an alias for PENDING_REVIEW.',
  })
  @IsEnum(TRIAGE_LIST_STATUS_VALUES)
  @IsOptional()
  status?: TriageListStatus;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  offset?: number;
}
