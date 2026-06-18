import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ApprovalEntityType } from '@prisma/client';

/**
 * Staff-side payload to REQUEST a client approval (status defaults to PENDING).
 * Used by the staff-guarded `POST /client-portal/approvals` route and by the
 * exported `ApprovalsService.request(...)` an integrator can call from any
 * staff surface.
 */
export class RequestApprovalDto {
  @ApiProperty({ enum: ApprovalEntityType, example: ApprovalEntityType.DOCUMENT })
  @IsEnum(ApprovalEntityType)
  entityType: ApprovalEntityType;

  @ApiProperty({
    example: 'document-uuid',
    description: 'Id of the document / deliverable / project being submitted.',
  })
  @IsString()
  @IsNotEmpty()
  entityId: string;

  @ApiProperty({
    required: false,
    example: 'project-uuid',
    description:
      'The project this approval is attached to. Drives client scoping: the ' +
      'requesting org/contact is resolved through this project when present.',
  })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({
    required: false,
    example: 'contact-uuid',
    description:
      'The specific contact asked to approve. When omitted, any portal client ' +
      "on the linked project's contact may act on it.",
  })
  @IsString()
  @IsOptional()
  approverContactId?: string;

  @ApiProperty({
    required: false,
    example: 'Please review the final logo pack and approve.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(5000)
  note?: string;
}
