import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { EmailService } from './email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { InstanceOperatorGuard } from '../common/guards/instance-operator.guard';
import { UserRole } from '@prisma/client';
import { CreateEmailConfigDto, EmailConfigResponseDto } from './dto/email-config.dto';
import { TestEmailDto } from './dto/test-email.dto';
import { TestTemplateEmailDto, EmailTemplateType } from './dto/test-template-email.dto';

/**
 * Shared SMTP relay administration.
 *
 * TENANCY: `email_config` is a SINGLE un-tenanted row — no workspaceId column,
 * no RLS — and `saveConfig()` calls `deleteMany()` before every write. Gated on
 * the global `UserRole.ADMIN` alone, any tenant's admin could destroy the
 * deployment's shared mail credentials and, via `test` / `test-template`, relay
 * arbitrary mail to arbitrary recipients through our domain.
 *
 * `InstanceOperatorGuard` therefore restricts this ENTIRE controller (config
 * read/write/delete AND the test-send routes) to an admin acting inside the
 * operator workspace. Applied at class level so a route added later inherits
 * the restriction by default rather than opting into it.
 */
@Controller('email')
@UseGuards(JwtAuthGuard, RolesGuard, InstanceOperatorGuard)
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  /**
   * Get current email configuration (admin only)
   * Password will be masked in response
   */
  @Get('config')
  @Roles(UserRole.ADMIN)
  async getConfig(): Promise<EmailConfigResponseDto | null> {
    return this.emailService.getConfig();
  }

  /**
   * Create or update email configuration (admin only)
   */
  @Post('config')
  @Roles(UserRole.ADMIN)
  async saveConfig(@Body() dto: CreateEmailConfigDto): Promise<EmailConfigResponseDto> {
    return this.emailService.saveConfig(dto);
  }

  /**
   * Delete email configuration (admin only)
   */
  @Delete('config')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConfig(): Promise<void> {
    return this.emailService.deleteConfig();
  }

  /**
   * Send test email (admin only)
   */
  @Post('test')
  @Roles(UserRole.ADMIN)
  async sendTestEmail(@Body() dto: TestEmailDto): Promise<{ success: boolean; message: string }> {
    return this.emailService.sendTestEmail(dto.to, dto.subject);
  }

  /**
   * Check if email service is configured
   */
  @Get('status')
  @Roles(UserRole.ADMIN)
  async getStatus(): Promise<{ configured: boolean; enabled: boolean }> {
    const isConfigured = await this.emailService.isConfigured();
    const config = await this.emailService.getConfig();
    return {
      configured: isConfigured,
      enabled: config?.isEnabled ?? false,
    };
  }

  /**
   * Send test email with specific template (admin only)
   */
  @Post('test-template')
  @Roles(UserRole.ADMIN)
  async sendTestTemplate(
    @Body() dto: TestTemplateEmailDto,
  ): Promise<{ success: boolean; message: string }> {
    const userName = dto.userName || 'Test User';
    const frontendUrl = process.env.FRONTEND_URL || 'https://projectops.unicorncommander.ai';

    switch (dto.template) {
      case EmailTemplateType.TEST:
        return this.emailService.sendTestEmail(dto.to, 'Test Email from Project Ops');

      case EmailTemplateType.PASSWORD_RESET:
        return this.emailService.sendPasswordResetEmail(
          dto.to,
          userName,
          `${frontendUrl}/auth/reset-password?token=test-token-123`,
        );

      case EmailTemplateType.PROJECT_ASSIGNED:
        return this.emailService.sendProjectAssignedEmail(
          dto.to,
          userName,
          'PROJ-2026-001',
          'Sample Project - Website Redesign',
          'Admin User',
          `${frontendUrl}/dashboard/projects/test-project-id`,
        );

      case EmailTemplateType.TASK_REMINDER:
        return this.emailService.sendTaskReminderEmail(
          dto.to,
          userName,
          'Review and submit project deliverables',
          new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString(), // 2 days from now
          'PROJ-2026-001',
          `${frontendUrl}/dashboard/tasks/test-task-id`,
        );

      case EmailTemplateType.DOCUMENT_UPLOAD:
        return this.emailService.sendDocumentUploadEmail(
          dto.to,
          userName,
          'Project_Deliverable_2026.pdf',
          'PROJ-2026-001',
          'Client Portal',
          `${frontendUrl}/dashboard/documents/test-doc-id`,
        );

      case EmailTemplateType.PROJECT_STATUS_UPDATE:
        return this.emailService.sendProjectStatusUpdateEmail(
          dto.to,
          userName,
          'PROJ-2026-001',
          'Sample Project - Website Redesign',
          'PENDING',
          'IN_PROGRESS',
          'Admin User',
          `${frontendUrl}/dashboard/projects/test-project-id`,
        );

      case EmailTemplateType.INVITATION:
        return this.emailService.sendInvitationEmail(
          dto.to,
          userName,
          `${frontendUrl}/auth/register?token=test-invitation-token`,
        );

      default:
        return {
          success: false,
          message: 'Invalid template type',
        };
    }
  }
}
