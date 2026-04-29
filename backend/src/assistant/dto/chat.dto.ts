import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChatMessageDto {
  @IsString()
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @MaxLength(20000)
  content!: string;
}

export class ChatRequestDto {
  @IsString()
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsArray()
  history?: ChatMessageDto[];

  /** Optional Project Ops context (project ID the user is currently viewing). */
  @IsOptional()
  @IsString()
  projectId?: string;
}
