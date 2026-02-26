import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class InviteContactDto {
  @ApiProperty({
    description: 'Whether to send invitation email to the contact',
    default: true,
    example: true
  })
  @IsBoolean()
  sendEmail: boolean = true;

  @ApiPropertyOptional({
    description: 'Custom message to include in the invitation email',
    example: 'Welcome to our client portal! We look forward to working with you.'
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  customMessage?: string;
}
