import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * A portal CLIENT's comment on one of their visible projects. The projectId
 * comes from the route param (`/client-portal/projects/:id/comments`), and
 * `isInternal` is FORCED false in the service — a client can never post an
 * internal (staff-only) comment, nor read one.
 */
export class CreatePortalCommentDto {
  @ApiProperty({ example: 'Thanks — this looks good to me.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;
}
