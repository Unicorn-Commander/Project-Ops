import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Create a new workspace. The caller supplies only a human display name; the
 * service derives a unique slug and self-mints the canonical id (uuid) on
 * dogfood, mirroring scripts/seed-phase2-tenancy.ts. The creating user becomes
 * the workspace OWNER.
 */
export class CreateWorkspaceDto {
  @ApiProperty({ example: 'Acme Consulting' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName: string;
}
