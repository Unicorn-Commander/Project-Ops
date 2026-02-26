import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../email/email.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { InviteContactDto } from './dto/invite-contact.dto';
import { ContactFiltersDto } from './dto/contact-filters.dto';
import { OrganizationContact, Prisma, UserRole } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a new contact
   */
  async create(dto: CreateContactDto, createdById: string): Promise<OrganizationContact> {
    try {
      // Check if email already exists
      const existing = await this.prisma.organizationContact.findUnique({
        where: { email: dto.email },
      });

      if (existing) {
        throw new ConflictException('A contact with this email already exists');
      }

      const contact = await this.prisma.organizationContact.create({
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          email: dto.email,
          phone: dto.phone,
          notes: dto.notes,
          isActive: dto.isActive ?? true,
          createdById,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              isActive: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });

      this.logger.log(`Contact created: ${contact.email} by user ${createdById}`);

      return contact;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('Email already exists');
        }
      }
      throw error;
    }
  }

  /**
   * Get all contacts with filtering and pagination
   */
  async findAll(
    filters: ContactFiltersDto,
    userId: string,
    userRole: UserRole,
  ): Promise<{ contacts: OrganizationContact[]; total: number; page: number; totalPages: number }> {
    const { search, isActive, portalAccessEnabled, page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = filters;

    // Build where clause based on user role
    const where: Prisma.OrganizationContactWhereInput = {};

    // Apply search filter
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { organization: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Apply status filters
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (portalAccessEnabled !== undefined) {
      where.portalAccessEnabled = portalAccessEnabled;
    }

    // Role-based filtering
    if (userRole === UserRole.STAFF) {
      // Staff can only see contacts for their assigned projects' organizations
      where.organization = {
        projects: {
          some: {
            assignedToId: userId,
          },
        },
      };
    }
    // ADMIN and MANAGER can see all contacts

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Build order by clause
    const orderBy: Prisma.OrganizationContactOrderByWithRelationInput = {};
    if (sortBy === 'firstName' || sortBy === 'lastName' || sortBy === 'email' || sortBy === 'createdAt') {
      orderBy[sortBy] = sortOrder;
    } else {
      orderBy.createdAt = 'desc';
    }

    // Execute query
    const [contacts, total] = await Promise.all([
      this.prisma.organizationContact.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              isActive: true,
              lastLoginAt: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
              _count: {
                select: {
                  projects: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.organizationContact.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      contacts,
      total,
      page,
      totalPages,
    };
  }

  /**
   * Get a single contact by ID
   */
  async findOne(id: string, userId: string, userRole: UserRole): Promise<OrganizationContact> {
    const contact = await this.prisma.organizationContact.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        organization: {
          include: {
            projects: {
              select: {
                id: true,
                projectNumber: true,
                title: true,
                status: true,
                priority: true,
                createdAt: true,
              },
              orderBy: {
                createdAt: 'desc',
              },
              take: 10,
            },
            _count: {
              select: {
                projects: true,
                contacts: true,
              },
            },
          },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }

    // Check permissions for staff
    if (userRole === UserRole.STAFF) {
      if (contact.organization) {
        const hasAccess = contact.organization.projects.some(c => c['assignedToId'] === userId);
        if (!hasAccess) {
          throw new ForbiddenException('You do not have access to this contact');
        }
      } else {
        throw new ForbiddenException('You do not have access to this contact');
      }
    }

    return contact;
  }

  /**
   * Find contact by email
   */
  async findByEmail(email: string): Promise<OrganizationContact | null> {
    return this.prisma.organizationContact.findUnique({
      where: { email },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });
  }

  /**
   * Get contacts by organization
   */
  async findByOrganization(organizationId: string): Promise<OrganizationContact[]> {
    return this.prisma.organizationContact.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
      orderBy: [
        { isPrimaryContact: 'desc' },
        { lastName: 'asc' },
      ],
    });
  }

  /**
   * Get primary contact for organization
   */
  async getPrimaryContact(organizationId: string): Promise<OrganizationContact | null> {
    return this.prisma.organizationContact.findFirst({
      where: {
        organizationId,
        isPrimaryContact: true,
        isActive: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
    });
  }

  /**
   * Update a contact
   */
  async update(id: string, dto: UpdateContactDto, userId: string, userRole: UserRole): Promise<OrganizationContact> {
    // Check if contact exists and user has permission
    const contact = await this.findOne(id, userId, userRole);

    // If changing email, check for conflicts
    if (dto.email && dto.email !== contact.email) {
      const existing = await this.prisma.organizationContact.findUnique({
        where: { email: dto.email },
      });

      if (existing) {
        throw new ConflictException('A contact with this email already exists');
      }
    }

    try {
      const updated = await this.prisma.organizationContact.update({
        where: { id },
        data: dto,
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              role: true,
              isActive: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
              type: true,
            },
          },
        },
      });

      this.logger.log(`Contact updated: ${updated.email} by user ${userId}`);

      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          throw new NotFoundException(`Contact with ID ${id} not found`);
        }
        if (error.code === 'P2002') {
          throw new ConflictException('Email already exists');
        }
      }
      throw error;
    }
  }

  /**
   * Delete a contact (hard delete)
   * Can only delete if no user account exists
   */
  async remove(id: string, userId: string, userRole: UserRole): Promise<void> {
    const contact = await this.findOne(id, userId, userRole);

    // Check if contact has user account
    if (contact.userId) {
      throw new BadRequestException(
        'Cannot delete contact with active portal account. Please unlink the user account first.',
      );
    }

    // Check if this is a primary contact
    if (contact.isPrimaryContact && contact.organizationId) {
      throw new BadRequestException(
        'Cannot delete primary contact. Please designate another contact as primary first.',
      );
    }

    await this.prisma.organizationContact.delete({
      where: { id },
    });

    this.logger.log(`Contact deleted: ${contact.email} by user ${userId}`);
  }

  /**
   * Set a contact as the primary contact for their organization
   */
  async setPrimaryContact(id: string, userId: string, userRole: UserRole): Promise<OrganizationContact> {
    const contact = await this.findOne(id, userId, userRole);

    if (!contact.organizationId) {
      throw new BadRequestException('Contact must belong to an organization to be set as primary');
    }

    // Unset any existing primary contact for this organization
    await this.prisma.organizationContact.updateMany({
      where: {
        organizationId: contact.organizationId,
        isPrimaryContact: true,
      },
      data: {
        isPrimaryContact: false,
      },
    });

    // Set this contact as primary
    const updated = await this.prisma.organizationContact.update({
      where: { id },
      data: {
        isPrimaryContact: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    this.logger.log(`Contact ${contact.email} set as primary for organization ${contact.organizationId} by user ${userId}`);

    return updated;
  }

  /**
   * Invite contact to client portal
   * Creates a user account with CLIENT role and sends invitation email
   */
  async inviteToPortal(
    id: string,
    dto: InviteContactDto,
    invitedById: string,
  ): Promise<{ success: boolean; message: string; invitationUrl?: string; temporaryPassword?: string }> {
    const contact = await this.prisma.organizationContact.findUnique({
      where: { id },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${id} not found`);
    }

    // Check if already invited
    if (contact.userId) {
      throw new BadRequestException('Contact already has portal access');
    }

    // Check if a user with this email already exists
    const existingUser = await this.prisma.user.findUnique({
      where: { email: contact.email },
    });

    if (existingUser) {
      throw new BadRequestException('A user with this email already exists. Please link the existing user instead.');
    }

    // Generate temporary password
    const temporaryPassword = randomBytes(16).toString('base64').substring(0, 12) + '!Aa1';
    const hashedPassword = await bcrypt.hash(temporaryPassword, 10);

    // Create user account
    const user = await this.prisma.user.create({
      data: {
        email: contact.email,
        username: contact.email,
        password: hashedPassword,
        firstName: contact.firstName,
        lastName: contact.lastName,
        role: UserRole.CLIENT,
        isActive: true,
        forcePasswordChange: true, // Force password change on first login
      },
    });

    // Link contact to user and enable portal access
    await this.prisma.organizationContact.update({
      where: { id },
      data: {
        userId: user.id,
        portalAccessEnabled: true,
      },
    });

    this.logger.log(`Portal account created for contact: ${contact.email}`);

    // Build login URL
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'https://projectops.unicorncommander.ai');
    const invitationUrl = `${frontendUrl}/auth/login`;

    // Send invitation email if requested
    if (dto.sendEmail) {
      const clientName = `${contact.firstName} ${contact.lastName}`;
      const firmName = contact.organization?.name || 'Project Ops';

      const emailResult = await this.emailService.sendInvitationEmail(
        contact.email,
        clientName,
        invitationUrl,
      );

      if (emailResult.success) {
        this.logger.log(`Invitation email sent to ${contact.email}`);
        return {
          success: true,
          message: 'Portal account created and invitation sent successfully',
          invitationUrl,
          temporaryPassword,
        };
      } else {
        this.logger.warn(`Failed to send invitation email to ${contact.email}: ${emailResult.message}`);
        return {
          success: true,
          message: 'Portal account created but email failed to send. Please provide credentials manually.',
          invitationUrl,
          temporaryPassword,
        };
      }
    }

    return {
      success: true,
      message: 'Portal account created successfully',
      invitationUrl,
      temporaryPassword,
    };
  }

  /**
   * Link an existing user account to a contact
   */
  async linkToUser(contactId: string, userId: string, adminUserId: string): Promise<OrganizationContact> {
    const contact = await this.prisma.organizationContact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found`);
    }

    if (contact.userId) {
      throw new BadRequestException('Contact already linked to a user account');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Check if user is already linked to another contact
    const existingLink = await this.prisma.organizationContact.findFirst({
      where: { userId },
    });

    if (existingLink) {
      throw new BadRequestException('User is already linked to another contact');
    }

    const updated = await this.prisma.organizationContact.update({
      where: { id: contactId },
      data: {
        userId,
        portalAccessEnabled: true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
        organization: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
    });

    this.logger.log(`Contact ${contact.email} linked to user ${user.email} by admin ${adminUserId}`);

    return updated;
  }

  /**
   * Unlink user account from contact
   */
  async unlinkFromUser(contactId: string, adminUserId: string): Promise<OrganizationContact> {
    const contact = await this.prisma.organizationContact.findUnique({
      where: { id: contactId },
    });

    if (!contact) {
      throw new NotFoundException(`Contact with ID ${contactId} not found`);
    }

    if (!contact.userId) {
      throw new BadRequestException('Contact is not linked to any user account');
    }

    const updated = await this.prisma.organizationContact.update({
      where: { id: contactId },
      data: {
        userId: null,
        portalAccessEnabled: false,
      },
    });

    this.logger.log(`Contact ${contact.email} unlinked from user account by admin ${adminUserId}`);

    return updated;
  }

  /**
   * Get contact statistics for dashboard
   */
  async getStats(): Promise<any> {
    const [totalContacts, activeContacts, withPortalAccess, primaryContacts] = await Promise.all([
      this.prisma.organizationContact.count(),
      this.prisma.organizationContact.count({ where: { isActive: true } }),
      this.prisma.organizationContact.count({ where: { portalAccessEnabled: true } }),
      this.prisma.organizationContact.count({ where: { isPrimaryContact: true } }),
    ]);

    return {
      totalContacts,
      activeContacts,
      withPortalAccess,
      primaryContacts,
    };
  }
}
