import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InviteClientDto {
  @ApiProperty({
    description: 'Send invitation email immediately',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  sendEmail?: boolean = true;
}
