import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClientSignupDto {
  @ApiProperty({
    example: 'SecurePassword123!',
    description: 'Password must be at least 8 characters',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password: string;

  @ApiProperty({
    example: 'SecurePassword123!',
    description: 'Must match the password field',
  })
  @IsString()
  @MinLength(8, { message: 'Confirm password must be at least 8 characters long' })
  confirmPassword: string;
}
