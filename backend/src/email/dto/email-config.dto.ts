import { IsString, IsInt, IsBoolean, IsEmail, IsOptional, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateEmailConfigDto {
  @IsString()
  smtpHost: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  smtpPort: number;

  // Accept both 'smtpSecure' (backend) and 'useTLS' (frontend)
  // Note: useTLS=true typically means STARTTLS (port 587), which requires smtpSecure=false
  // smtpSecure=true is for SSL/TLS (port 465)
  @IsBoolean()
  @Transform(({ obj }) => {
    if (obj.smtpSecure !== undefined) return obj.smtpSecure;
    // If useTLS is provided, convert: useTLS=true -> smtpSecure=false (STARTTLS)
    if (obj.useTLS !== undefined) return !obj.useTLS;
    return false;
  })
  smtpSecure: boolean;

  // Accept both 'smtpUser' (backend) and 'email' (frontend)
  @IsEmail()
  @Transform(({ obj }) => obj.smtpUser ?? obj.email)
  smtpUser: string;

  // Accept both 'smtpPassword' (backend) and 'password' (frontend)
  @IsString()
  @Transform(({ obj }) => obj.smtpPassword ?? obj.password)
  smtpPassword: string;

  @IsString()
  fromName: string;

  // Accept both 'fromEmail' (backend) and 'email' (frontend)
  @IsEmail()
  @Transform(({ obj }) => obj.fromEmail ?? obj.email)
  fromEmail: string;

  // Accept both 'isEnabled' (backend) and 'enabled' (frontend)
  @IsBoolean()
  @IsOptional()
  @Transform(({ obj }) => obj.isEnabled ?? obj.enabled ?? false)
  isEnabled?: boolean;

  // Optional provider field for frontend
  @IsString()
  @IsOptional()
  provider?: string;

  // Frontend field aliases (optional, for documentation)
  @IsBoolean()
  @IsOptional()
  useTLS?: boolean;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}

export class UpdateEmailConfigDto {
  @IsString()
  @IsOptional()
  smtpHost?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  smtpPort?: number;

  @IsBoolean()
  @IsOptional()
  smtpSecure?: boolean;

  @IsEmail()
  @IsOptional()
  smtpUser?: string;

  @IsString()
  @IsOptional()
  smtpPassword?: string;

  @IsString()
  @IsOptional()
  fromName?: string;

  @IsEmail()
  @IsOptional()
  fromEmail?: string;

  @IsBoolean()
  @IsOptional()
  isEnabled?: boolean;
}

export class EmailConfigResponseDto {
  id: string;
  provider?: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword: string; // Will be masked in controller
  fromName: string;
  fromEmail: string;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}
