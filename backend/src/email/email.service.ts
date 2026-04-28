import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { CreateEmailConfigDto, UpdateEmailConfigDto, EmailConfigResponseDto } from './dto/email-config.dto';
import { getInvitationEmailTemplate, getTestEmailTemplate } from './templates/invitation.template';
import { getPasswordResetEmailTemplate } from './templates/password-reset.template';
import { getProjectAssignedEmailTemplate } from './templates/project-assigned.template';
import { getTaskReminderEmailTemplate } from './templates/task-reminder.template';
import { getTaskAssignedEmailTemplate } from './templates/task-assigned.template';
import { getDocumentUploadEmailTemplate } from './templates/document-upload.template';
import { getProjectStatusUpdateEmailTemplate } from './templates/project-status-update.template';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_IV_LENGTH = 16;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-cbc';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    // Initialize encryption key from environment or generate one
    const envKey = this.configService.get<string>('EMAIL_ENCRYPTION_KEY');
    if (envKey && envKey.length === 64) {
      this.ENCRYPTION_KEY = Buffer.from(envKey, 'hex');
    } else {
      // Generate a random key (in production, store this in env!)
      this.ENCRYPTION_KEY = randomBytes(32);
      this.logger.warn('Using randomly generated encryption key. Set EMAIL_ENCRYPTION_KEY in .env for production!');
    }
  }

  /**
   * Encrypt password before storing in database
   */
  private encryptPassword(password: string): string {
    const iv = randomBytes(this.ENCRYPTION_IV_LENGTH);
    const cipher = createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(password, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // Prepend IV to encrypted data
    return iv.toString('hex') + ':' + encrypted;
  }

  /**
   * Decrypt password when reading from database
   */
  private decryptPassword(encryptedPassword: string): string {
    const parts = encryptedPassword.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Create SMTP transporter with current configuration
   */
  private async createTransporter(): Promise<Transporter | null> {
    try {
      // First try to get config from database
      const dbConfig = await this.prisma.emailConfig.findFirst({
        where: { isEnabled: true },
      });

      if (dbConfig) {
        const decryptedPassword = this.decryptPassword(dbConfig.smtpPassword);
        return nodemailer.createTransport({
          host: dbConfig.smtpHost,
          port: dbConfig.smtpPort,
          secure: dbConfig.smtpSecure,
          auth: {
            user: dbConfig.smtpUser,
            pass: decryptedPassword,
          },
        });
      }

      // Fallback to environment variables
      const envHost = this.configService.get<string>('SMTP_HOST');
      const envUser = this.configService.get<string>('SMTP_USER');
      const envPassword = this.configService.get<string>('SMTP_PASSWORD');

      if (envHost && envUser && envPassword) {
        this.logger.log('Using SMTP configuration from environment variables');
        return nodemailer.createTransport({
          host: envHost,
          port: this.configService.get<number>('SMTP_PORT', 587),
          secure: this.configService.get<boolean>('SMTP_SECURE', false),
          auth: {
            user: envUser,
            pass: envPassword,
          },
        });
      }

      this.logger.warn('No email configuration found in database or environment');
      return null;
    } catch (error) {
      this.logger.error('Failed to create email transporter', error);
      return null;
    }
  }

  /**
   * Get current email configuration (with masked password)
   */
  async getConfig(): Promise<EmailConfigResponseDto | null> {
    const config = await this.prisma.emailConfig.findFirst();
    if (!config) {
      return null;
    }

    return {
      ...config,
      smtpPassword: '********', // Mask password in response
    };
  }

  /**
   * Create or update email configuration
   */
  async saveConfig(dto: CreateEmailConfigDto): Promise<EmailConfigResponseDto> {
    const encryptedPassword = this.encryptPassword(dto.smtpPassword);

    // Delete any existing config (we only support one config for now)
    await this.prisma.emailConfig.deleteMany();

    const config = await this.prisma.emailConfig.create({
      data: {
        provider: dto.provider,
        smtpHost: dto.smtpHost,
        smtpPort: dto.smtpPort,
        smtpSecure: dto.smtpSecure,
        smtpUser: dto.smtpUser,
        smtpPassword: encryptedPassword,
        fromName: dto.fromName,
        fromEmail: dto.fromEmail,
        isEnabled: dto.isEnabled ?? false,
      },
    });

    this.logger.log('Email configuration saved successfully');

    return {
      ...config,
      smtpPassword: '********', // Mask password in response
    };
  }

  /**
   * Update email configuration
   */
  async updateConfig(dto: UpdateEmailConfigDto): Promise<EmailConfigResponseDto> {
    const existing = await this.prisma.emailConfig.findFirst();
    if (!existing) {
      throw new NotFoundException('Email configuration not found. Please create one first.');
    }

    const updateData: any = { ...dto };

    // Encrypt password if provided
    if (dto.smtpPassword) {
      updateData.smtpPassword = this.encryptPassword(dto.smtpPassword);
    }

    const config = await this.prisma.emailConfig.update({
      where: { id: existing.id },
      data: updateData,
    });

    this.logger.log('Email configuration updated successfully');

    return {
      ...config,
      smtpPassword: '********', // Mask password in response
    };
  }

  /**
   * Delete email configuration
   */
  async deleteConfig(): Promise<void> {
    await this.prisma.emailConfig.deleteMany();
    this.logger.log('Email configuration deleted');
  }

  /**
   * Send test email
   */
  async sendTestEmail(to: string, subject?: string): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new BadRequestException('Email is not configured. Please configure SMTP settings first.');
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject: subject || 'Project Ops - Email Configuration Test',
        html: getTestEmailTemplate(fromName),
      });

      this.logger.log(`Test email sent successfully to ${to}. Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Test email sent successfully to ${to}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send test email to ${to}`, error);
      throw new BadRequestException(
        `Failed to send test email: ${error.message}. Please check your SMTP settings.`,
      );
    }
  }

  /**
   * Send client portal invitation email
   */
  async sendInvitationEmail(
    clientEmail: string,
    clientName: string,
    invitationUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping invitation email.');
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: clientEmail,
        subject: `You've been invited to ${fromName} Client Portal`,
        html: getInvitationEmailTemplate(clientName, invitationUrl, fromName),
      });

      this.logger.log(`Invitation email sent to ${clientEmail}. Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Invitation email sent to ${clientEmail}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${clientEmail}`, error);
      return {
        success: false,
        message: `Failed to send email: ${error.message}`,
      };
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    email: string,
    userName: string,
    resetLink: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping password reset email.');
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: 'Password Reset Request',
        html: getPasswordResetEmailTemplate(userName, resetLink, fromName),
      });

      this.logger.log(`Password reset email sent to ${email}. Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Password reset email sent to ${email}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}`, error);
      return {
        success: false,
        message: `Failed to send email: ${error.message}`,
      };
    }
  }

  /**
   * Send project assigned email notification
   */
  async sendProjectAssignedEmail(
    email: string,
    userName: string,
    projectNumber: string,
    projectName: string,
    assignedBy: string,
    projectUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping project assigned email.');
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `New Project Assigned: ${projectNumber}`,
        html: getProjectAssignedEmailTemplate(userName, projectNumber, projectName, assignedBy, projectUrl, fromName),
      });

      this.logger.log(`Project assigned email sent to ${email}. Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Project assigned email sent to ${email}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send project assigned email to ${email}`, error);
      return {
        success: false,
        message: `Failed to send email: ${error.message}`,
      };
    }
  }

  /**
   * Send task reminder email
   */
  async sendTaskReminderEmail(
    email: string,
    userName: string,
    taskTitle: string,
    dueDate: string,
    projectNumber: string,
    taskUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping task reminder email.');
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `Task Reminder: ${taskTitle}`,
        html: getTaskReminderEmailTemplate(userName, taskTitle, dueDate, projectNumber, taskUrl, fromName),
      });

      this.logger.log(`Task reminder email sent to ${email}. Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Task reminder email sent to ${email}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send task reminder email to ${email}`, error);
      return {
        success: false,
        message: `Failed to send email: ${error.message}`,
      };
    }
  }

  /**
   * Send task-assigned notification email
   */
  async sendTaskAssignedEmail(
    email: string,
    userName: string,
    taskTitle: string,
    projectNumber: string,
    projectTitle: string,
    assignedBy: string,
    dueDate: string | null,
    taskUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping task assigned email.');
      return { success: false, message: 'Email service not configured' };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `New Task: ${taskTitle}`,
        html: getTaskAssignedEmailTemplate(
          userName,
          taskTitle,
          projectNumber,
          projectTitle,
          assignedBy,
          dueDate,
          taskUrl,
          fromName,
        ),
      });

      this.logger.log(`Task assigned email sent to ${email}. Message ID: ${info.messageId}`);
      return { success: true, message: `Task assigned email sent to ${email}` };
    } catch (error) {
      this.logger.error(`Failed to send task assigned email to ${email}`, error);
      return { success: false, message: `Failed to send email: ${error.message}` };
    }
  }

  /**
   * Send document upload notification email
   */
  async sendDocumentUploadEmail(
    email: string,
    userName: string,
    documentName: string,
    projectNumber: string,
    uploadedBy: string,
    documentUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping document upload email.');
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `New Document Uploaded: ${documentName}`,
        html: getDocumentUploadEmailTemplate(userName, documentName, projectNumber, uploadedBy, documentUrl, fromName),
      });

      this.logger.log(`Document upload email sent to ${email}. Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Document upload email sent to ${email}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send document upload email to ${email}`, error);
      return {
        success: false,
        message: `Failed to send email: ${error.message}`,
      };
    }
  }

  /**
   * Send project status update notification email
   */
  async sendProjectStatusUpdateEmail(
    email: string,
    userName: string,
    projectNumber: string,
    projectName: string,
    oldStatus: string,
    newStatus: string,
    updatedBy: string,
    projectUrl: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping project status update email.');
      return {
        success: false,
        message: 'Email service not configured',
      };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName = config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `Project Status Updated: ${projectNumber}`,
        html: getProjectStatusUpdateEmailTemplate(userName, projectNumber, projectName, oldStatus, newStatus, updatedBy, projectUrl, fromName),
      });

      this.logger.log(`Project status update email sent to ${email}. Message ID: ${info.messageId}`);
      return {
        success: true,
        message: `Project status update email sent to ${email}`,
      };
    } catch (error) {
      this.logger.error(`Failed to send project status update email to ${email}`, error);
      return {
        success: false,
        message: `Failed to send email: ${error.message}`,
      };
    }
  }

  /**
   * Check if email service is configured and enabled
   */
  async isConfigured(): Promise<boolean> {
    const dbConfig = await this.prisma.emailConfig.findFirst({
      where: { isEnabled: true },
    });

    if (dbConfig) {
      return true;
    }

    // Check environment variables as fallback
    const envHost = this.configService.get<string>('SMTP_HOST');
    const envUser = this.configService.get<string>('SMTP_USER');
    const envPassword = this.configService.get<string>('SMTP_PASSWORD');

    return !!(envHost && envUser && envPassword);
  }
}
