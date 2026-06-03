import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class StartTimerDto {
  @ApiProperty({ required: false, description: 'Project to log against. Required unless taskId is given.' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ required: false, description: 'Task to log against; its project is used automatically.' })
  @IsString()
  @IsOptional()
  taskId?: string;

  @ApiProperty({ required: false, example: 'Drafting the Q3 proposal' })
  @IsString()
  @IsOptional()
  description?: string;
}
