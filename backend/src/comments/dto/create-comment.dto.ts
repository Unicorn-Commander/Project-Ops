import { IsString, IsNotEmpty, IsBoolean, IsOptional, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ example: 'project-uuid' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ example: 'This is a comment on the project' })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ example: false, required: false })
  @IsBoolean()
  @IsOptional()
  isInternal?: boolean;

  @ApiProperty({ required: false, type: 'object' })
  @IsObject()
  @IsOptional()
  metadata?: any;
}