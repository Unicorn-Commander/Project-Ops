import { Inject, Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_OPS_PORT, EmailOpsPort } from '../email-ops/email-ops.port';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  CreateEmailConfigDto,
  UpdateEmailConfigDto,
  EmailConfigResponseDto,
} from './dto/email-config.dto';
import { getInvitationEmailTemplate, getTestEmailTemplate } from './templates/invitation.template';
import { getPasswordResetEmailTemplate } from './templates/password-reset.template';
import { getProjectAssignedEmailTemplate } from './templates/project-assigned.template';
import { getTaskReminderEmailTemplate } from './templates/task-reminder.template';
import { getTaskAssignedEmailTemplate } from './templates/task-assigned.template';
import { getDocumentUploadEmailTemplate } from './templates/document-upload.template';
import { getProjectStatusUpdateEmailTemplate } from './templates/project-status-update.template';
import {
  NotificationEmailContent,
  getNotificationEmailHtml,
  getNotificationEmailText,
} from './templates/notification.template';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly ENCRYPTION_KEY: Buffer;
  private readonly ENCRYPTION_IV_LENGTH = 16;
  private readonly ENCRYPTION_ALGORITHM = 'aes-256-cbc';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    // Optional Email-Ops port. Wired only when EmailOpsModule is imported;
    // when unconfigured (EMAIL_OPS_BASE_URL unset) the port is inert and every
    // send path below keeps its today-SMTP behaviour.
    @Optional() @Inject(EMAIL_OPS_PORT) private readonly emailOps?: EmailOpsPort,
  ) {
    // Initialize the field-encryption key from the environment.
    //
    // Fail-closed in production: a stored SMTP password is encrypted under this
    // key, so a random per-process fallback would silently make every stored
    // password undecryptable after the next restart. We refuse to construct the
    // service in that case (env validation in src/config/env.validation.ts is
    // the first line of defense; this is defense-in-depth so the footgun can
    // never fire even if validation is bypassed). A 64-char hex string == the
    // required 32 bytes for AES-256.
    const envKey = this.configService.get<string>('EMAIL_ENCRYPTION_KEY');
    const isProduction =
      (this.configService.get<string>('NODE_ENV') ?? 'production') === 'production';
    const validHexKey = typeof envKey === 'string' && /^[0-9a-fA-F]{64}$/.test(envKey);

    if (validHexKey) {
      this.ENCRYPTION_KEY = Buffer.from(envKey as string, 'hex');
    } else if (isProduction) {
      // Boot-blocking: an admin-set SMTP password must survive restarts.
      throw new Error(
        'EMAIL_ENCRYPTION_KEY must be set to a 64-char hex string in production ' +
          '(generate: openssl rand -hex 32). Refusing to start with an ephemeral ' +
          'key — stored SMTP passwords would become undecryptable after restart.',
      );
    } else {
      // Dev/test only: a throwaway key keeps local boot + tests frictionless.
      this.ENCRYPTION_KEY = randomBytes(32);
      this.logger.warn(
        'EMAIL_ENCRYPTION_KEY unset/invalid — using an ephemeral key (dev/test only). ' +
          'Stored SMTP passwords will NOT survive a restart. Set a 64-char hex key for production.',
      );
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
  async sendTestEmail(
    to: string,
    subject?: string,
  ): Promise<{ success: boolean; message: string }> {
    const transporter = await this.createTransporter();
    if (!transporter) {
      throw new BadRequestException(
        'Email is not configured. Please configure SMTP settings first.',
      );
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
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
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
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
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
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
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `New Project Assigned: ${projectNumber}`,
        html: getProjectAssignedEmailTemplate(
          userName,
          projectNumber,
          projectName,
          assignedBy,
          projectUrl,
          fromName,
        ),
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
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `Task Reminder: ${taskTitle}`,
        html: getTaskReminderEmailTemplate(
          userName,
          taskTitle,
          dueDate,
          projectNumber,
          taskUrl,
          fromName,
        ),
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
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
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
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `New Document Uploaded: ${documentName}`,
        html: getDocumentUploadEmailTemplate(
          userName,
          documentName,
          projectNumber,
          uploadedBy,
          documentUrl,
          fromName,
        ),
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
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: email,
        subject: `Project Status Updated: ${projectNumber}`,
        html: getProjectStatusUpdateEmailTemplate(
          userName,
          projectNumber,
          projectName,
          oldStatus,
          newStatus,
          updatedBy,
          projectUrl,
          fromName,
        ),
      });

      this.logger.log(
        `Project status update email sent to ${email}. Message ID: ${info.messageId}`,
      );
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
   * Send a generic, template-driven NOTIFICATION email (subject + one-line body
   * + a deep-link CTA). This is the single send path the notifications module
   * uses for per-event emails: it REUSES the same SMTP transporter, the same
   * from-name/from-email resolution, and the same resilient try/catch contract
   * as every other method here (returns `{ success, message }`, never throws on
   * an SMTP failure). The CALLER (the notifications email listener) owns the
   * per-user preference gate; this method just renders + sends.
   *
   * Sends BOTH an HTML and a plain-text part (multipart/alternative) for better
   * deliverability and text-only clients.
   */
  async sendNotificationEmail(
    to: string,
    recipientName: string,
    content: NotificationEmailContent,
    routing?: { workspaceId: string; externalRef: string },
  ): Promise<{ success: boolean; message: string }> {
    // Email-Ops routing (internal notifications = mode `send`). When the port
    // is configured AND the caller supplied the workspace idempotency key, route
    // through Email-Ops instead of the local SMTP transporter. Otherwise this
    // method is byte-identical to today's behaviour.
    if (this.emailOps?.isConfigured() && routing?.workspaceId && routing?.externalRef) {
      // Resolve the same from-name the SMTP path uses (cosmetic in the body
      // copy; Email-Ops owns the actual envelope sender).
      const emailConfig = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
      const fromName =
        emailConfig?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');

      const result = await this.emailOps.compose({
        workspaceId: routing.workspaceId,
        externalRef: routing.externalRef,
        toAddress: to,
        subject: content.subject,
        body: getNotificationEmailText(content, recipientName, fromName),
        mode: 'send',
      });
      if (result.ok) {
        this.logger.log(`Notification email routed through Email-Ops (${result.messageId}) to ${to}`);
        return { success: true, message: `Notification email composed in Email-Ops (${result.messageId})` };
      }
      this.logger.warn(`Email-Ops route failed (${result.reason}): ${result.message}`);
      return { success: false, message: `Email-Ops route failed: ${result.message}` };
    }

    const transporter = await this.createTransporter();
    if (!transporter) {
      this.logger.warn('Email not configured. Skipping notification email.');
      return { success: false, message: 'Email service not configured' };
    }

    const config = await this.prisma.emailConfig.findFirst({ where: { isEnabled: true } });
    const fromName =
      config?.fromName || this.configService.get<string>('SMTP_FROM_NAME', 'Project Ops');
    const fromEmail = config?.fromEmail || this.configService.get<string>('SMTP_USER', '');

    try {
      const info = await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to,
        subject: content.subject,
        text: getNotificationEmailText(content, recipientName, fromName),
        html: getNotificationEmailHtml(content, recipientName, fromName),
      });

      this.logger.log(`Notification email sent to ${to}. Message ID: ${info.messageId}`);
      return { success: true, message: `Notification email sent to ${to}` };
    } catch (error) {
      this.logger.error(`Failed to send notification email to ${to}`, error);
      return { success: false, message: `Failed to send email: ${error.message}` };
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

  /**
   * True when ANY mail transport can send: the local SMTP config OR the
   * Email-Ops port. The notification listener gates on this (rather than the
   * SMTP-only `isConfigured`) so a deployment that routes mail exclusively
   * through Email-Ops (no SMTP) still delivers.
   */
  async canSend(): Promise<boolean> {
    if (await this.isConfigured()) return true;
    return !!this.emailOps?.isConfigured();
  }
}
