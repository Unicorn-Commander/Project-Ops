import { IsString, IsEnum, IsOptional, IsObject } from 'class-validator';
import { AuditAction } from '@prisma/client';

export class CreateAuditLogDto {
  @IsString()
  @IsOptional()
  userId?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsEnum(AuditAction)
  action: AuditAction;

  @IsString()
  resource: string;

  @IsString()
  @IsOptional()
  resourceId?: string;

  @IsObject()
  @IsOptional()
  details?: any;

  @IsString()
  @IsOptional()
  ipAddress?: string;

  @IsString()
  @IsOptional()
  userAgent?: string;
}