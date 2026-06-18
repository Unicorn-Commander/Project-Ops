import { ArrayNotEmpty, IsArray, IsBoolean, IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WEBHOOK_EVENTS } from '../webhook-events';

export class UpdateWebhookDto {
  @ApiProperty({ required: false, example: 'https://hooks.example.com/project-ops' })
  @IsUrl({ require_tld: false, require_protocol: true })
  @IsOptional()
  url?: string;

  @ApiProperty({ required: false, enum: WEBHOOK_EVENTS, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsOptional()
  events?: string[];

  @ApiProperty({ required: false, description: 'Enable/disable delivery to this endpoint.' })
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    required: false,
    description:
      'Set true to rotate the signing secret. The NEW secret is returned ONCE in the response; subsequent reads only ever show a masked hint.',
  })
  @IsBoolean()
  @IsOptional()
  rotateSecret?: boolean;
}
