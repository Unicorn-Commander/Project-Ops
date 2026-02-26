import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignTaskDto {
  @ApiProperty({ example: 'uuid-of-user' })
  @IsString()
  @IsNotEmpty()
  assignedToId: string;
}
