import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePatDto {
  @ApiProperty({
    example: "Claude Code on Aaron's Mac",
    description: 'Human-readable label so the user can identify the token later.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: '019e50a3-d995-723f-ab66-0f765f92c0f4',
    required: false,
    description:
      'Workspace this token is scoped to. Must be a workspace the caller is an ' +
      'ACTIVE member of. Omit to bind the token to your default workspace. The ' +
      'minted PAT can ONLY act inside this single workspace — cross-workspace ' +
      'calls are rejected at the auth chokepoint.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  workspaceId?: string;

  @ApiProperty({
    example: ['read:projects', 'write:tasks'],
    required: false,
    description:
      'Scope list. Defaults to read-only across projects/tasks/documents/activity when omitted.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[];

  @ApiProperty({
    example: '2026-09-01T00:00:00.000Z',
    required: false,
    description:
      'ISO timestamp at which the token expires. Omit for a non-expiring token (NOT recommended).',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
