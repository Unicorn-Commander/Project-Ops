import { ApiProperty } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, MaxLength } from 'class-validator';

/**
 * Roles an OWNER/ADMIN may assign when sharing a workspace. OWNER is
 * intentionally NOT assignable here — a second owner is granted via the
 * role-change path (PATCH), not by inviting a brand-new collaborator, so the
 * "share" surface can't accidentally hand out ownership.
 */
export const ASSIGNABLE_MEMBER_ROLES = [
  WorkspaceRole.VIEWER,
  WorkspaceRole.MEMBER,
  WorkspaceRole.MANAGER,
  WorkspaceRole.ADMIN,
] as const;

export class AddMemberDto {
  @ApiProperty({ example: 'teammate@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({
    enum: ASSIGNABLE_MEMBER_ROLES,
    example: WorkspaceRole.MEMBER,
    required: false,
    default: WorkspaceRole.MEMBER,
    description:
      'Role to grant. Defaults to MEMBER. OWNER cannot be granted here; use the role-change endpoint.',
  })
  @IsOptional()
  @IsEnum(WorkspaceRole)
  role?: WorkspaceRole;
}
