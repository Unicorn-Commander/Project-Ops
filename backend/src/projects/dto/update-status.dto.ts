import { IsEnum, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ProjectStatus } from '@prisma/client';

export class UpdateProjectStatusDto {
  @ApiProperty({ enum: ProjectStatus, example: ProjectStatus.IN_PROGRESS })
  @IsEnum(ProjectStatus)
  @IsNotEmpty()
  status: ProjectStatus;
}
