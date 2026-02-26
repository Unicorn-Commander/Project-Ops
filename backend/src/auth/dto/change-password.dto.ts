import { IsString, IsNotEmpty, MinLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword123!',
    description: 'Current password for verification',
  })
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @ApiProperty({
    example: 'NewSecurePass123!',
    description: 'New password (min 12 chars, must include uppercase, lowercase, number, and special character)',
    minLength: 12,
  })
  @IsString()
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(12, { message: 'Password must be at least 12 characters long' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]/,
    {
      message:
        'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&#)',
    },
  )
  newPassword: string;
}
