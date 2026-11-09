import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { InternalApprovalDecision, InternalApprovalEntity } from '@prisma/client';

export class InternalApprovalBindingDto {
  @IsUUID()
  projectId: string;

  @IsEnum(InternalApprovalEntity)
  entity: InternalApprovalEntity;

  @IsString()
  @Matches(/^\S(?:[\s\S]*\S)?$/)
  @MaxLength(300)
  entityRef: string;

  // Opaque, case-sensitive version identity: full git SHAs or other content hashes.
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(128)
  versionHash: string;
}

export class RecordInternalApprovalDto extends InternalApprovalBindingDto {
  @IsEnum(InternalApprovalDecision)
  decision: InternalApprovalDecision;

  @IsString()
  @Matches(/\S/)
  @MaxLength(5000)
  reason: string;
}

export class ListInternalApprovalsDto {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsEnum(InternalApprovalEntity)
  entity?: InternalApprovalEntity;

  @IsOptional()
  @IsString()
  @Matches(/^\S(?:[\s\S]*\S)?$/)
  @MaxLength(300)
  entityRef?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\S+$/)
  @MaxLength(128)
  versionHash?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
