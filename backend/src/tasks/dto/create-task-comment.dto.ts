import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTaskCommentDto {
  @ApiProperty({ example: 'I have uploaded the deliverables to the project documents.' })
  @IsString()
  @IsNotEmpty()
  content: string;
}
