import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WEBHOOK_EVENTS } from '../webhook-events';

export class CreateWebhookDto {
  @ApiProperty({
    description:
      'HTTPS endpoint that will receive POSTed events. Plain http is rejected unless the host is localhost/127.0.0.1 (dev receivers).',
    example: 'https://hooks.example.com/project-ops',
  })
  // require_tld off so localhost passes the validator; the https/loopback rule
  // is enforced in the service (assertDeliverableUrl) where we can special-case
  // dev hosts.
  @IsUrl({ require_tld: false, require_protocol: true })
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'Event names to subscribe to. Each must be a known Project-Ops event.',
    example: ['task.created', 'task.completed', 'project.status_changed'],
    enum: WEBHOOK_EVENTS,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events: string[];

  @ApiProperty({ description: 'Optional human-readable label.', required: false })
  @IsString()
  @IsOptional()
  description?: string;
}
