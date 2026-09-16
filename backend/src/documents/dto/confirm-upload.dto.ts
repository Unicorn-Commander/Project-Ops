import { IsString, IsNotEmpty, IsInt, IsOptional, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConfirmUploadDto {
  @ApiProperty({ example: 'project-uuid', required: false })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ example: 'document.pdf' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 1024000, description: 'File size in bytes (max 100MB)' })
  @IsInt()
  @IsNotEmpty()
  @Max(100 * 1024 * 1024, { message: 'File size cannot exceed 100MB' })
  fileSize: number;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 'projects/xxx/file.pdf' })
  @IsString()
  @IsNotEmpty()
  storagePath: string;
}
