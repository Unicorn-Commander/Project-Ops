import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

/**
 * Change an existing member's role. OWNER may promote to any role (including
 * OWNER, to add a co-owner) or demote — except the service refuses to demote
 * the LAST remaining OWNER (which would orphan the workspace).
 */
export class UpdateMemberRoleDto {
  @ApiProperty({ enum: WorkspaceRole, example: WorkspaceRole.MANAGER })
  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}
