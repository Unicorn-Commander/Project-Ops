import { IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTaskCommentDto {
  @ApiProperty({ example: 'Updated comment body after review.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;
}
