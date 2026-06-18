import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ClientApprovalStatus } from '@prisma/client';

/**
 * A portal CLIENT's decision on one of THEIR pending approvals. The terminal
 * statuses a client may set are APPROVED / REJECTED / CHANGES_REQUESTED —
 * PENDING is the request state staff create and is intentionally NOT an
 * accepted decision value (validated by the enum subset below).
 */
export class DecideApprovalDto {
  @ApiProperty({
    enum: [
      ClientApprovalStatus.APPROVED,
      ClientApprovalStatus.REJECTED,
      ClientApprovalStatus.CHANGES_REQUESTED,
    ],
    example: ClientApprovalStatus.APPROVED,
    description: 'The client decision. PENDING is not an accepted value.',
  })
  // Restrict to the three terminal decisions; a client can never set PENDING.
  @IsEnum(
    {
      APPROVED: ClientApprovalStatus.APPROVED,
      REJECTED: ClientApprovalStatus.REJECTED,
      CHANGES_REQUESTED: ClientApprovalStatus.CHANGES_REQUESTED,
    },
    { message: 'decision must be one of APPROVED, REJECTED, CHANGES_REQUESTED' },
  )
  decision: ClientApprovalStatus;

  @ApiProperty({
    required: false,
    example: 'Looks great — approved.',
    description: 'Optional note recorded as the decisionNote.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  note?: string;
}
