import { IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignProjectDto {
  @ApiProperty({
    type: String,
    example: 'user-uuid',
    description: 'User ID to assign the project to. Pass null or omit to unassign the project.',
    required: false,
    nullable: true,
  })
  @IsOptional()
  assignedToId?: string | null;
}
