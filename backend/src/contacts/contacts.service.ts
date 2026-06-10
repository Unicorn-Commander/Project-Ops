import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { User, WorkspaceRole, MembershipStatus } from '@prisma/client';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { EmailService } from '../email/email.service';
import { AuditService } from '../audit/audit.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * SUITE TENANCY (Phase 2, B6): every Contact (and Contact→Project) read/write
 * runs inside `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)`
 * so the DB RLS GUC scopes it to the acting user's active workspace. All
 * contacts-owned DB access goes through the passed `tx`, never `this.prisma`.
 *
 * The email-uniqueness pre-flight checks (create + update) run INSIDE the
 * workspace tx, so they are scoped to the active workspace — matching the
 * schema's `@@unique([workspaceId, email])`. Two workspaces may each have a
 * contact with the same email; only a collision WITHIN a workspace is rejected.
 *
 * `findContactProjects` / `getContactStats` run the Contact existence check and
 * the Project rollups in the SAME runForUser callback so both halves observe
 * one consistent workspace scope (and one membership authorization).
 *
 * Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off (membership
 * resolution is a no-op and withWorkspace runs under the BYPASSRLS owner
 * connection, preserving today's behavior).
 */
@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private prisma: PrismaService,
    private readonly workspaceContext: WorkspaceContextService,
    private emailService: EmailService,
    private auditService: AuditService,
  ) {}

  /**
   * Load a contact (with relations) inside an existing workspace tx, throwing
   * NotFound if absent. Used by methods that already run within a runForUser
   * callback so they don't open (and re-authorize) a second workspace tx.
   */
  private async findOneInTx(tx: WorkspaceTxClient, id: string) {
    const contact = await tx.contact.findUnique({
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

  async create(
    workspaceId: string,
    user: User,
    createContactDto: CreateContactDto,
  ) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Email-uniqueness pre-flight. Runs INSIDE the workspace tx, so it is
        // scoped to the active workspace (matches @@unique([workspaceId, email]));
        // a contact with the same email in another workspace is not a conflict.
        const existingContact = await tx.contact.findFirst({
          where: { email: createContactDto.email },
        });

        if (existingContact) {
          throw new ConflictException(
            'Contact with this email already exists',
          );
        }

        const contact = await tx.contact.create({
          data: {
            ...createContactDto,
            workspaceId,
            createdById: user.id,
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

        // Audit logging (workspace-scoped per Phase 2 A1).
        await this.auditService.log({
          workspaceId,
          userId: user.id,
          action: 'CREATE',
          resource: 'Contact',
          resourceId: contact.id,
          details: {
            contactName: `${contact.firstName} ${contact.lastName}`,
            email: contact.email,
          },
        });

        this.logger.log(
          `Contact created: ${contact.firstName} ${contact.lastName} (${contact.email}) by user ${user.id} ws=${workspaceId}`,
        );

        return contact;
      },
      workspaceId,
    );
  }

  async findAll(
    workspaceId: string,
    user: User,
    params?: {
      skip?: number;
      take?: number;
      search?: string;
      isActive?: boolean;
    },
  ) {
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

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [contacts, total] = await Promise.all([
          tx.contact.findMany({
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
          tx.contact.count({ where }),
        ]);

        return {
          data: contacts,
          total,
          skip,
          take,
        };
      },
      workspaceId,
    );
  }

  async findOne(workspaceId: string, user: User, id: string) {
    return this.workspaceContext.runForUser(
      user,
      (tx) => this.findOneInTx(tx, id),
      workspaceId,
    );
  }

  async update(
    workspaceId: string,
    user: User,
    id: string,
    updateContactDto: UpdateContactDto,
  ) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Check if contact exists (workspace-scoped via tx).
        await this.findOneInTx(tx, id);

        // If email is being updated, check for conflicts. Runs INSIDE the
        // workspace tx, so it is scoped to the active workspace (matches
        // @@unique([workspaceId, email])).
        if (updateContactDto.email) {
          const existingContact = await tx.contact.findFirst({
            where: { email: updateContactDto.email },
          });

          if (existingContact && existingContact.id !== id) {
            throw new ConflictException(
              'Contact with this email already exists',
            );
          }
        }

        const contact = await tx.contact.update({
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

        // Audit logging (workspace-scoped per Phase 2 A1).
        await this.auditService.log({
          workspaceId,
          userId: user.id,
          action: 'UPDATE',
          resource: 'Contact',
          resourceId: id,
          details: updateContactDto,
        });

        this.logger.log(
          `Contact updated: ${contact.firstName} ${contact.lastName} (${contact.id}) by user ${user.id} ws=${workspaceId}`,
        );

        return contact;
      },
      workspaceId,
    );
  }

  async remove(workspaceId: string, user: User, id: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Check if contact exists (workspace-scoped via tx).
        const contact = await this.findOneInTx(tx, id);

        // Soft delete - just set isActive to false
        const deletedContact = await tx.contact.update({
          where: { id },
          data: { isActive: false },
        });

        // Audit logging (workspace-scoped per Phase 2 A1).
        await this.auditService.log({
          workspaceId,
          userId: user.id,
          action: 'DELETE',
          resource: 'Contact',
          resourceId: id,
          details: {
            contactName: `${contact.firstName} ${contact.lastName}`,
            email: contact.email,
          },
        });

        this.logger.log(
          `Contact deleted (soft): ${contact.firstName} ${contact.lastName} (${id}) by user ${user.id} ws=${workspaceId}`,
        );

        return deletedContact;
      },
      workspaceId,
    );
  }

  async findContactProjects(
    workspaceId: string,
    user: User,
    id: string,
    params?: { skip?: number; take?: number },
  ) {
    const { skip = 0, take = 50 } = params || {};

    // Contact existence check AND the project rollup run in the SAME workspace
    // tx so both observe one consistent scope (and one membership auth).
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        await this.findOneInTx(tx, id);

        const [projects, total] = await Promise.all([
          tx.project.findMany({
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
          tx.project.count({ where: { contactId: id } }),
        ]);

        return {
          data: projects,
          total,
          skip,
          take,
        };
      },
      workspaceId,
    );
  }

  async getContactBillingSummary(workspaceId: string, user: User, id: string) {
    // Contact existence check AND the project billing rollup run in the SAME
    // workspace tx so both observe one consistent scope.
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        await this.findOneInTx(tx, id);

        const projects = await tx.project.findMany({
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
            totalBilled = totalBilled.add(
              new Decimal(project.billingAmount.toString()),
            );
          }
          if (project.amountPaid) {
            totalPaid = totalPaid.add(
              new Decimal(project.amountPaid.toString()),
            );
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
            billingAmount: project.billingAmount
              ? parseFloat(project.billingAmount.toString())
              : null,
            amountPaid: project.amountPaid
              ? parseFloat(project.amountPaid.toString())
              : null,
          })),
        };
      },
      workspaceId,
    );
  }

  async getContactStats(workspaceId: string, user: User) {
    // Contact + their Project rollups run in ONE workspace tx (R0/R4): both the
    // contact set and the per-contact projects must be the active workspace's.
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Get top 5 contacts by total billing amount
        const allContacts = await tx.contact.findMany({
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
              totalBilled = totalBilled.add(
                new Decimal(project.billingAmount.toString()),
              );
            }
            if (project.amountPaid) {
              totalPaid = totalPaid.add(
                new Decimal(project.amountPaid.toString()),
              );
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
      },
      workspaceId,
    );
  }

  async inviteToPortal(
    workspaceId: string,
    user: User,
    contactId: string,
  ): Promise<{
    invitationToken: string;
    invitationUrl: string;
    emailSent: boolean;
    emailMessage?: string;
  }> {
    // Resolve the contact + write the invitation fields inside the workspace tx.
    // Email send (external I/O) happens AFTER the tx, on the returned values.
    const { contact, invitationToken } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const found = await tx.contact.findUnique({
          where: { id: contactId },
        });

        if (!found) {
          throw new NotFoundException(
            `Contact with ID ${contactId} not found`,
          );
        }

        // Check if contact already has a user account
        if (found.userId) {
          throw new BadRequestException('Contact already has portal access');
        }

        // Generate random 32-character token
        const crypto = require('crypto');
        const token = crypto.randomBytes(16).toString('hex');

        // Update contact with invitation details
        await tx.contact.update({
          where: { id: contactId },
          data: {
            invitationToken: token,
            invitationSentAt: new Date(),
            portalAccessEnabled: true,
          },
        });

        // Provisional control-plane membership binding token → workspace. The
        // memberships table is RLS-OFF, so clientSignup can read this row with
        // no GUC and learn which workspace the (FORCE-RLS) Contact lives in —
        // resolving the chicken-and-egg. Reconciled to the real user key at
        // signup; consumed there so the token can't be replayed. CLIENT →
        // VIEWER (suite role map). Keyed on (userKey, workspaceId) so re-invite
        // is idempotent.
        await tx.membership.upsert({
          where: {
            userKey_workspaceId: { userKey: `invite:${token}`, workspaceId },
          },
          update: {},
          create: {
            userKey: `invite:${token}`,
            workspaceId,
            role: WorkspaceRole.VIEWER,
            status: MembershipStatus.ACTIVE,
            isDefault: true,
          },
        });

        return { contact: found, invitationToken: token };
      },
      workspaceId,
    );

    // Generate invitation URL
    const frontendUrl =
      process.env.FRONTEND_URL || 'https://projectops.unicorncommander.ai';
    const invitationUrl = `${frontendUrl}/auth/contact-signup/${invitationToken}`;

    // Try to send invitation email (external I/O, outside the workspace tx)
    let emailSent = false;
    let emailMessage: string | undefined;

    try {
      const isConfigured = await this.emailService.isConfigured();

      if (isConfigured) {
        const contactName = `${contact.firstName} ${contact.lastName}`;
        const emailResult = await this.emailService.sendInvitationEmail(
          contact.email,
          contactName,
          invitationUrl,
        );

        emailSent = emailResult.success;
        emailMessage = emailResult.message;

        if (emailSent) {
          this.logger.log(`Invitation email sent to ${contact.email}`);
        } else {
          this.logger.warn(
            `Failed to send invitation email to ${contact.email}: ${emailMessage}`,
          );
        }
      } else {
        this.logger.warn(
          'Email service not configured. Invitation created but email not sent.',
        );
        emailMessage = 'Email service not configured';
      }
    } catch (error) {
      this.logger.error(
        `Error sending invitation email to ${contact.email}`,
        error,
      );
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
