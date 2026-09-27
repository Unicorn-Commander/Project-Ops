import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PaymentStatus, User } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { WorkspaceTxClient } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePortalCommentDto } from './dto/create-portal-comment.dto';
import { clampLimit, clampOffset } from '../common/pagination/clamp';
import { QuotePanel, QuotePanelService } from '../customer-ops/quote-panel.service';

/**
 * Read-only portal surface for CLIENT users: their own projects, project
 * details, and documents (resolved via the Contact profile linked to the user).
 *
 * Suite tenancy (Phase 2, G3): every query runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes Contact/Project/Document reads to the active workspace. All
 * scoped-model access goes through the passed `tx`, never `this.prisma`. The
 * pre-existing client-scoping (contact.id ownership) + ForbiddenException on
 * cross-contact project access are preserved verbatim — they now run on top of
 * the workspace fence. The whole method body shares ONE runForUser so the
 * contact lookup and its dependent reads see the same GUC and resolve under a
 * single membership authorization. Additive + inert while
 * PROJECT_OPS_TENANCY_ENABLED is off (membership resolution is a no-op and
 * withWorkspace runs under the BYPASSRLS owner connection).
 */
@Injectable()
export class ClientPortalService {
  private readonly logger = new Logger(ClientPortalService.name);

  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
    private readonly quotePanel: QuotePanelService,
  ) {}

  /**
   * Resolve (and require) the portal Contact for the signed-in user, inside an
   * existing workspace tx. Shared by every portal method so the contact lookup
   * and its dependent reads always run under the same GUC.
   */
  private async requireContact(tx: WorkspaceTxClient, user: User, workspaceId: string) {
    const contact = await tx.contact.findUnique({
      where: { userId: user.id, workspaceId, isActive: true, portalAccessEnabled: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact profile not found');
    }
    return contact;
  }

  /**
   * Load a project and assert it belongs to `contactId`, inside an existing
   * workspace tx. 404 when the project does not resolve under the workspace
   * RLS scope; 403 when it resolves but is another contact's project (mirrors
   * getProjectDetails). Returns the project row for callers that need it.
   */
  private async requireOwnedProject(
    tx: WorkspaceTxClient,
    contactId: string,
    projectId: string,
    workspaceId: string,
  ) {
    const project = await tx.project.findUnique({
      where: { id: projectId, workspaceId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    if (project.contactId !== contactId) {
      throw new ForbiddenException('You do not have access to this project');
    }
    return project;
  }

  async getDashboard(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Find the contact profile for this user
        const contact = await tx.contact.findUnique({
          where: { userId: user.id, workspaceId, isActive: true, portalAccessEnabled: true },
        });

        if (!contact) {
          throw new NotFoundException('Contact profile not found');
        }

        // Get projects count
        const projectsCount = await tx.project.count({
          where: { contactId: contact.id, workspaceId },
        });

        // Get recent projects (5 most recent)
        const recentProjects = await tx.project.findMany({
          where: { contactId: contact.id, workspaceId },
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            _count: {
              select: {
                documents: { where: { workspaceId, isClientVisible: true, status: 'UPLOADED' } },
                comments: { where: { workspaceId, isInternal: false } },
              },
            },
          },
        });

        // Get documents count
        const documentsCount = await tx.document.count({
          where: {
            isClientVisible: true,
            status: 'UPLOADED',
            workspaceId,
            project: {
              contactId: contact.id,
            },
          },
        });

        return {
          projectsCount: projectsCount,
          documentsCount,
          recentProjects: recentProjects.map((case_) => ({
            id: case_.id,
            projectNumber: case_.projectNumber,
            title: case_.title,
            status: case_.status,
            priority: case_.priority,
            dueDate: case_.dueDate,
            createdAt: case_.createdAt,
            assignedTo: case_.assignedTo,
            documentsCount: case_._count.documents,
            commentsCount: case_._count.comments,
          })),
        };
      },
      workspaceId,
    );
  }

  async getProjects(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Find the contact profile for this user
        const contact = await tx.contact.findUnique({
          where: { userId: user.id, workspaceId, isActive: true, portalAccessEnabled: true },
        });

        if (!contact) {
          throw new NotFoundException('Contact profile not found');
        }

        const projects = await tx.project.findMany({
          where: { contactId: contact.id, workspaceId },
          orderBy: { createdAt: 'desc' },
          include: {
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            _count: {
              select: {
                documents: { where: { workspaceId, isClientVisible: true, status: 'UPLOADED' } },
                comments: { where: { workspaceId, isInternal: false } },
              },
            },
          },
        });

        return projects.map((case_) => ({
          id: case_.id,
          projectNumber: case_.projectNumber,
          title: case_.title,
          description: case_.clientDescription,
          status: case_.status,
          priority: case_.priority,
          dueDate: case_.dueDate,
          completedAt: case_.completedAt,
          createdAt: case_.createdAt,
          updatedAt: case_.updatedAt,
          assignedTo: case_.assignedTo,
          documentsCount: case_._count.documents,
          commentsCount: case_._count.comments,
          billingAmount: case_.billingAmount ? parseFloat(case_.billingAmount.toString()) : null,
          amountPaid: case_.amountPaid ? parseFloat(case_.amountPaid.toString()) : null,
          paymentStatus: case_.paymentStatus,
          billingDate: case_.billingDate,
          paymentDueDate: case_.paymentDueDate,
        }));
      },
      workspaceId,
    );
  }

  async getProjectDetails(workspaceId: string, user: User, projectId: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Find the contact profile for this user
        const contact = await tx.contact.findUnique({
          where: { userId: user.id, workspaceId, isActive: true, portalAccessEnabled: true },
        });

        if (!contact) {
          throw new NotFoundException('Contact profile not found');
        }

        // Get the project with full details
        const case_ = await tx.project.findUnique({
          where: { id: projectId, workspaceId },
          include: {
            assignedTo: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            documents: {
              where: { workspaceId, isClientVisible: true, status: 'UPLOADED' },
              orderBy: { uploadedAt: 'desc' },
              select: {
                id: true,
                fileName: true,
                fileSize: true,
                mimeType: true,
                status: true,
                description: true,
                uploadedAt: true,
                uploadedBy: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
            comments: {
              where: { workspaceId, isInternal: false }, // Only show non-internal comments to clients
              orderBy: { createdAt: 'desc' },
              include: {
                author: {
                  select: {
                    firstName: true,
                    lastName: true,
                    role: true,
                  },
                },
              },
            },
          },
        });

        if (!case_) {
          throw new NotFoundException('Project not found');
        }

        // Verify ownership - ensure this project belongs to this contact
        if (case_.contactId !== contact.id) {
          throw new ForbiddenException('You do not have access to this project');
        }

        return {
          id: case_.id,
          projectNumber: case_.projectNumber,
          title: case_.title,
          description: case_.clientDescription,
          status: case_.status,
          priority: case_.priority,
          dueDate: case_.dueDate,
          completedAt: case_.completedAt,
          createdAt: case_.createdAt,
          updatedAt: case_.updatedAt,
          assignedTo: case_.assignedTo,
          billingAmount: case_.billingAmount ? parseFloat(case_.billingAmount.toString()) : null,
          amountPaid: case_.amountPaid ? parseFloat(case_.amountPaid.toString()) : null,
          paymentStatus: case_.paymentStatus,
          billingDate: case_.billingDate,
          paymentDueDate: case_.paymentDueDate,
          paymentReceivedDate: case_.paymentReceivedDate,
          invoiceNumber: case_.invoiceNumber,
          documents: case_.documents,
          comments: case_.comments,
        };
      },
      workspaceId,
    );
  }

  /**
   * The client's Quote panel for one of THEIR projects (QUOTES-CONTRACT-v1 §3,
   * §5): number, title, totals, status and the share link ONLY. Ownership
   * (contact ↔ project) is asserted inside the workspace tx exactly like
   * getProjectDetails; the Customer-Ops read-through runs OUTSIDE the tx and
   * degrades to the cached summary. `{ linked: false }` when the project did
   * not come from a quote.
   */
  async getProjectQuote(workspaceId: string, user: User, projectId: string): Promise<QuotePanel> {
    const project = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const contact = await this.requireContact(tx, user, workspaceId);
        return this.requireOwnedProject(tx, contact.id, projectId, workspaceId);
      },
      workspaceId,
    );
    return this.quotePanel.buildPanel({ id: project.id, metadata: project.metadata }, 'client', {
      workspaceId,
    });
  }

  async getDocuments(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Find the contact profile for this user
        const contact = await tx.contact.findUnique({
          where: { userId: user.id, workspaceId, isActive: true, portalAccessEnabled: true },
        });

        if (!contact) {
          throw new NotFoundException('Contact profile not found');
        }

        // Get all documents for projects belonging to this contact
        const documents = await tx.document.findMany({
          where: {
            isClientVisible: true,
            status: 'UPLOADED',
            workspaceId,
            project: {
              contactId: contact.id,
            },
          },
          orderBy: { uploadedAt: 'desc' },
          include: {
            project: {
              select: {
                id: true,
                projectNumber: true,
                title: true,
              },
            },
            uploadedBy: {
              select: {
                firstName: true,
                lastName: true,
                role: true,
              },
            },
          },
        });

        return documents.map(
          ({
            id,
            fileName,
            fileSize,
            mimeType,
            status,
            description,
            uploadedAt,
            project,
            uploadedBy,
          }) => ({
            id,
            fileName,
            fileSize,
            mimeType,
            status,
            description,
            uploadedAt,
            project,
            uploadedBy,
          }),
        );
      },
      workspaceId,
    );
  }

  // ======================================================================
  // COMMENTS (two-way) — a portal client reads + posts on THEIR projects.
  // ======================================================================

  /**
   * List the non-internal comments on a project the client owns. Reuses the
   * existing Comment model directly (the comments module is not owned here);
   * `isInternal: false` is enforced so staff-only comments never surface, and
   * the project-ownership check 403/404s anything outside the client's scope.
   */
  async getProjectComments(
    workspaceId: string,
    user: User,
    projectId: string,
    params?: { take?: number; skip?: number },
  ) {
    const { take, skip } = params || {};

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const contact = await this.requireContact(tx, user, workspaceId);
        await this.requireOwnedProject(tx, contact.id, projectId, workspaceId);

        const comments = await tx.comment.findMany({
          where: { workspaceId, projectId, isInternal: false },
          orderBy: { createdAt: 'desc' },
          take: clampLimit(take, 50),
          skip: clampOffset(skip),
          include: {
            author: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
          },
        });

        return comments.map((c) => this.transformComment(c));
      },
      workspaceId,
    );
  }

  /**
   * Post a comment as the signed-in client on a project they own. `isInternal`
   * is FORCED false (a client can never create an internal comment); the author
   * is the client's user. Emits the same `comment.created` event the comments
   * module uses so the realtime gateway relays it, and audits the write.
   */
  async createProjectComment(
    workspaceId: string,
    user: User,
    projectId: string,
    dto: CreatePortalCommentDto,
  ) {
    const comment = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const contact = await this.requireContact(tx, user, workspaceId);
        await this.requireOwnedProject(tx, contact.id, projectId, workspaceId);

        return tx.comment.create({
          data: {
            workspaceId,
            projectId,
            authorId: user.id,
            content: dto.content,
            // Hard-coded: portal clients only ever create client-visible comments.
            isInternal: false,
          },
          include: {
            author: {
              select: { id: true, firstName: true, lastName: true, role: true },
            },
          },
        });
      },
      workspaceId,
    );

    const transformed = this.transformComment(comment);

    // Same event shape the comments module emits; the gateway listener only
    // relays the payload to the project room (no unscoped re-query).
    this.eventEmitter.emit('comment.created', {
      workspaceId,
      projectId,
      comment: transformed,
    });

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      projectId,
      action: 'CREATE',
      resource: 'Comment',
      resourceId: comment.id,
      details: { content: comment.content.substring(0, 100), portal: true },
    });

    this.logger.log(
      `Portal comment ${comment.id} created on project ${projectId} by user ${user.id} ws=${workspaceId}`,
    );
    return transformed;
  }

  /** Shape a Comment row into the portal contract. */
  private transformComment(comment: any) {
    return {
      id: comment.id,
      projectId: comment.projectId,
      content: comment.content,
      isInternal: comment.isInternal,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      author: comment.author
        ? {
            id: comment.author.id,
            name: `${comment.author.firstName} ${comment.author.lastName}`,
            role: comment.author.role,
          }
        : null,
    };
  }

  // ======================================================================
  // INVOICES (read-only) — projection of the client's billable projects.
  // ======================================================================
  //
  // Project-Ops has no standalone Invoice model; invoice/billing data lives on
  // the Project row (invoiceNumber, billingAmount, amountPaid, paymentStatus,
  // billing/payment dates) and is reconciled into Accounting-Ops via the
  // billable-draft / sync_invoice_status MCP flow. The portal surfaces that
  // rollup READ-ONLY here. Money movement is NEVER auto-executed: `payUrl` is a
  // deep-link stub to the portal checkout for an open balance, not a payment.

  /** List the client's invoices (projects that carry billing data). */
  async getInvoices(workspaceId: string, user: User) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const contact = await this.requireContact(tx, user, workspaceId);

        const projects = await tx.project.findMany({
          where: {
            contactId: contact.id,
            workspaceId,
            // "Has an invoice" == a billing number was assigned OR an amount set.
            OR: [{ invoiceNumber: { not: null } }, { billingAmount: { not: null } }],
          },
          orderBy: [{ billingDate: 'desc' }, { createdAt: 'desc' }],
        });

        return projects.map((p) => this.transformInvoice(p));
      },
      workspaceId,
    );
  }

  /** Get one invoice (a billable project the client owns). */
  async getInvoiceById(workspaceId: string, user: User, projectId: string) {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const contact = await this.requireContact(tx, user, workspaceId);
        const project = await this.requireOwnedProject(tx, contact.id, projectId, workspaceId);

        if (!project.invoiceNumber && project.billingAmount == null) {
          // The project is the client's but has no billing data — there is no
          // invoice to show.
          throw new NotFoundException('Invoice not found');
        }
        return this.transformInvoice(project);
      },
      workspaceId,
    );
  }

  /**
   * Project an invoice view from a Project row. Computes the outstanding
   * balance and, when there IS an unpaid balance, a checkout DEEP-LINK stub
   * (the portal frontend route that initiates payment) — never an executed
   * charge. The id is the project id (invoices are not separately keyed).
   */
  private transformInvoice(p: any) {
    const billingAmount = p.billingAmount != null ? parseFloat(p.billingAmount.toString()) : null;
    const amountPaid = p.amountPaid != null ? parseFloat(p.amountPaid.toString()) : 0;
    const balanceDue =
      billingAmount != null
        ? Math.max(0, Math.round((billingAmount - amountPaid) * 100) / 100)
        : null;

    const isPayable =
      balanceDue != null && balanceDue > 0 && p.paymentStatus !== PaymentStatus.CANCELLED;

    return {
      id: p.id,
      projectId: p.id,
      projectNumber: p.projectNumber,
      projectTitle: p.title,
      invoiceNumber: p.invoiceNumber,
      paymentStatus: p.paymentStatus,
      billingAmount,
      amountPaid,
      balanceDue,
      billingDate: p.billingDate,
      paymentDueDate: p.paymentDueDate,
      paymentReceivedDate: p.paymentReceivedDate,
      // Deep-link stub only — DO NOT execute payment from the portal/agent.
      // Null unless there is an open balance to pay.
      payUrl: isPayable ? `/client-portal/invoices/${p.id}/pay` : null,
    };
  }
}
