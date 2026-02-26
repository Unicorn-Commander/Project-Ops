import { IsEmail, IsString, IsEnum } from 'class-validator';

export enum EmailTemplateType {
  TEST = 'test',
  PASSWORD_RESET = 'password-reset',
  PROJECT_ASSIGNED = 'project-assigned',
  TASK_REMINDER = 'task-reminder',
  DOCUMENT_UPLOAD = 'document-upload',
  PROJECT_STATUS_UPDATE = 'project-status-update',
  INVITATION = 'invitation',
}

export class TestTemplateEmailDto {
  @IsEmail()
  to: string;

  @IsEnum(EmailTemplateType)
  template: EmailTemplateType;

  @IsString()
  userName?: string;
}
