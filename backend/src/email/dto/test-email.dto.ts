import { IsEmail, IsString, IsOptional } from 'class-validator';

export class TestEmailDto {
  @IsEmail()
  to: string;

  @IsString()
  @IsOptional()
  subject?: string;
}
