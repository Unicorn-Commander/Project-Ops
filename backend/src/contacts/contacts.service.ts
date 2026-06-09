import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private auditService: AuditService,
  ) {}

  async create(createContactDto: CreateContactDto, createdById: string) {
    // Check if email already exists.
    // NOTE: email is no longer globally unique (now @@unique([workspaceId, email]));
    // use findFirst to preserve the existing global pre-flight check. Phase B (B6)
    // re-scopes this lookup to the active workspace.
    const existingContact = await this.prisma.contact.findFirst({
      where: { email: createContactDto.email },
    });

    if (existingContact) {
      throw new ConflictException('Contact with this email already exists');
    }

    const contact = await this.prisma.contact.create({
      data: {
        ...createContactDto,
        createdById,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    // Audit logging
    await this.auditService.log({
      userId: createdById,
      action: 'CREATE',
      resource: 'Contact',
      resourceId: contact.id,
      details: {
        contactName: `${contact.firstName} ${contact.lastName}`,
        email: contact.email,
      },
    });

    this.logger.log(`Contact created: ${contact.firstName} ${contact.lastName} (${contact.email}) by user ${createdById}`);

    return contact;
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    search?: string;
    isActive?: boolean;
  }) {
    const { skip = 0, take = 50, search, isActive } = params || {};

    const where: any = {};

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip,
        take,
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          _count: {
            select: {
              projects: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      data: contacts,
      total,
      skip,
      take,
    };
  }

  async findOne(id: string) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        organization: true,
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
        _count: {
          select: {
            projects: true,
          },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }

    return contact;
  }

  async update(id: string, updateContactDto: UpdateContactDto, userId: string) {
    // Check if contact exists
    await this.findOne(id);

    // If email is being updated, check for conflicts.
    // NOTE: email is no longer globally unique (now @@unique([workspaceId, email]));
    // use findFirst to preserve the existing global pre-flight check. Phase B (B6)
    // re-scopes this lookup to the active workspace.
    if (updateContactDto.email) {
      const existingContact = await this.prisma.contact.findFirst({
        where: { email: updateContactDto.email },
      });

      if (existingContact && existingContact.id !== id) {
        throw new ConflictException('Contact with this email already exists');
      }
    }

    const contact = await this.prisma.contact.update({
      where: { id },
      data: updateContactDto,
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    // Audit logging
    await this.auditService.log({
      userId,
      action: 'UPDATE',
      resource: 'Contact',
      resourceId: id,
      details: updateContactDto,
    });

    this.logger.log(`Contact updated: ${contact.firstName} ${contact.lastName} (${contact.id}) by user ${userId}`);

    return contact;
  }

  async remove(id: string, userId: string) {
    // Check if contact exists
    const contact = await this.findOne(id);

    // Soft delete - just set isActive to false
    const deletedContact = await this.prisma.contact.update({
      where: { id },
      data: { isActive: false },
    });

    // Audit logging
    await this.auditService.log({
      userId,
      action: 'DELETE',
      resource: 'Contact',
      resourceId: id,
      details: {
        contactName: `${contact.firstName} ${contact.lastName}`,
        email: contact.email,
      },
    });

    this.logger.log(`Contact deleted (soft): ${contact.firstName} ${contact.lastName} (${id}) by user ${userId}`);

    return deletedContact;
  }

  async findContactProjects(id: string, params?: { skip?: number; take?: number }) {
    const { skip = 0, take = 50 } = params || {};

    // Check if contact exists
    await this.findOne(id);

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        where: { contactId: id },
        skip,
        take,
        include: {
          assignedTo: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
            },
          },
          _count: {
            select: {
              documents: true,
              comments: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.project.count({ where: { contactId: id } }),
    ]);

    return {
      data: projects,
      total,
      skip,
      take,
    };
  }

  async getContactBillingSummary(id: string) {
    // Check if contact exists
    await this.findOne(id);

    const projects = await this.prisma.project.findMany({
      where: { contactId: id },
      select: {
        id: true,
        projectNumber: true,
        title: true,
        billingAmount: true,
        amountPaid: true,
        paymentStatus: true,
        billingDate: true,
        paymentDueDate: true,
        paymentReceivedDate: true,
      },
    });

    // Calculate totals
    let totalBilled = new Decimal(0);
    let totalPaid = new Decimal(0);

    projects.forEach((project) => {
      if (project.billingAmount) {
        totalBilled = totalBilled.add(new Decimal(project.billingAmount.toString()));
      }
      if (project.amountPaid) {
        totalPaid = totalPaid.add(new Decimal(project.amountPaid.toString()));
      }
    });

    const outstanding = totalBilled.minus(totalPaid);

    return {
      totalBilled: totalBilled.toNumber(),
      totalPaid: totalPaid.toNumber(),
      outstanding: outstanding.toNumber(),
      projectsCount: projects.length,
      projects: projects.map((project) => ({
        ...project,
        billingAmount: project.billingAmount ? parseFloat(project.billingAmount.toString()) : null,
        amountPaid: project.amountPaid ? parseFloat(project.amountPaid.toString()) : null,
      })),
    };
  }

  async getContactStats() {
    // Get top 5 contacts by total billing amount
    const allContacts = await this.prisma.contact.findMany({
      where: { isActive: true },
      include: {
        projects: {
          select: {
            billingAmount: true,
            amountPaid: true,
          },
        },
      },
    });

    const contactsWithStats = allContacts.map((contact) => {
      let totalBilled = new Decimal(0);
      let totalPaid = new Decimal(0);
      let projectsCount = contact.projects.length;

      contact.projects.forEach((project) => {
        if (project.billingAmount) {
          totalBilled = totalBilled.add(new Decimal(project.billingAmount.toString()));
        }
        if (project.amountPaid) {
          totalPaid = totalPaid.add(new Decimal(project.amountPaid.toString()));
        }
      });

      const outstanding = totalBilled.minus(totalPaid);

      return {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email,
        company: contact.company,
        projectsCount,
        totalBilled: totalBilled.toNumber(),
        totalPaid: totalPaid.toNumber(),
        outstanding: outstanding.toNumber(),
      };
    });

    // Sort by total billed (descending) and take top 5
    const topContacts = contactsWithStats
      .sort((a, b) => b.totalBilled - a.totalBilled)
      .slice(0, 5);

    return {
      topContacts,
      totalContacts: allContacts.length,
    };
  }

  async inviteToPortal(
    contactId: string,
  ): Promise<{ invitationToken: string; invitationUrl: string; emailSent: boolean; emailMessage?: string }> {
    // Check if contact exists
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found`);
    }

    // Check if contact already has a user account
    if (contact.userId) {
      throw new BadRequestException('Contact already has portal access');
    }

    // Generate random 32-character token
    const crypto = require('crypto');
    const invitationToken = crypto.randomBytes(16).toString('hex');

    // Update contact with invitation details
    await this.prisma.contact.update({
      where: { id: contactId },
      data: {
        invitationToken,
        invitationSentAt: new Date(),
        portalAccessEnabled: true,
      },
    });

    // Generate invitation URL
    const frontendUrl = process.env.FRONTEND_URL || 'https://projectops.unicorncommander.ai';
    const invitationUrl = `${frontendUrl}/auth/contact-signup/${invitationToken}`;

    // Try to send invitation email
    let emailSent = false;
    let emailMessage: string | undefined;

    try {
      const isConfigured = await this.emailService.isConfigured();

      if (isConfigured) {
        const contactName = `${contact.firstName} ${contact.lastName}`;
        const emailResult = await this.emailService.sendInvitationEmail(contact.email, contactName, invitationUrl);

        emailSent = emailResult.success;
        emailMessage = emailResult.message;

        if (emailSent) {
          this.logger.log(`Invitation email sent to ${contact.email}`);
        } else {
          this.logger.warn(`Failed to send invitation email to ${contact.email}: ${emailMessage}`);
        }
      } else {
        this.logger.warn('Email service not configured. Invitation created but email not sent.');
        emailMessage = 'Email service not configured';
      }
    } catch (error) {
      this.logger.error(`Error sending invitation email to ${contact.email}`, error);
      emailMessage = 'Failed to send email';
    }

    return {
      invitationToken,
      invitationUrl,
      emailSent,
      emailMessage,
    };
  }
}
