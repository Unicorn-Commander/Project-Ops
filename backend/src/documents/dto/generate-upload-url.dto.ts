import { IsString, IsNotEmpty, IsOptional, IsNumber, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateUploadUrlDto {
  @ApiProperty({ example: 'project-uuid', required: false })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ example: 'document.pdf' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 1024000, description: 'File size in bytes (max 100MB)' })
  @IsNumber()
  @IsNotEmpty()
  @Max(100 * 1024 * 1024, { message: 'File size cannot exceed 100MB' })
  fileSize: number;
}
