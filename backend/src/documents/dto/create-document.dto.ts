import { IsString, IsNotEmpty, IsInt, IsEnum, IsOptional, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { DocumentStatus } from '@prisma/client';

export class CreateDocumentDto {
  @ApiProperty({ example: 'project-uuid' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ example: 'project-deliverable.pdf' })
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @ApiProperty({ example: 1024000 })
  @IsInt()
  @IsNotEmpty()
  fileSize: number;

  @ApiProperty({ example: 'application/pdf' })
  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @ApiProperty({ example: 'projects/project-id/file-uuid.pdf' })
  @IsString()
  @IsNotEmpty()
  s3Key: string;

  @ApiProperty({ enum: DocumentStatus, required: false })
  @IsEnum(DocumentStatus)
  @IsOptional()
  status?: DocumentStatus;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsOptional()
  tags?: string[];
}
