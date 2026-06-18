import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Approval, ClientApprovalStatus, Prisma, User } from '@prisma/client';
import { WorkspaceContextService } from '../../common/workspace/workspace-context.service';
import { WorkspaceTxClient } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { RequestApprovalDto } from './dto/request-approval.dto';
import { DecideApprovalDto } from './dto/decide-approval.dto';
import { clampLimit, clampOffset } from '../../common/pagination/clamp';

/**
 * Approvals service — the two-way spine of the client portal.
 *
 * SUITE TENANCY: every read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes Approval/Project/Contact access to the active workspace; all
 * DB access goes through the passed `tx`, never `this.prisma`. New rows stamp
 * `workspaceId`.
 *
 * PORTAL SCOPING (on top of the workspace fence): the Approval table has no
 * direct Contact relation — a row "belongs to" a portal client when it is
 * addressed to that client's contact. We resolve ownership two ways:
 *   1. `approverContactId === contact.id`            (addressed to this contact), OR
 *   2. `approverContactId IS NULL` AND the linked `project.contactId === contact.id`
 *      (addressed to whoever owns the linked project).
 * A client may only LIST or DECIDE approvals they own; everything else 404s
 * (we surface 404, not 403, for rows outside the client's scope so the portal
 * never confirms the existence of another org's approval).
 *
 * Two callers:
 *   - `request(...)`  — STAFF create a PENDING request. Exposed both as the
 *     staff-guarded POST route on the portal controller AND as this public
 *     method an integrator can wire from any other staff surface.
 *   - `listForContact` / `decide` — the CLIENT-facing read + decision, gated by
 *     the controller's `verifyClientRole` + the contact-ownership checks here.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly auditService: AuditService,
  ) {}

  // ----------------------------------------------------------------------
  // STAFF: request an approval
  // ----------------------------------------------------------------------

  /**
   * Create a PENDING approval request. `requestedBy` is the acting staff user.
   * When `projectId` is supplied it is validated to exist in the workspace (a
   * cross-workspace id is invisible under RLS → NotFound). Callable directly by
   * an integrator from a staff surface, or via the staff-guarded portal route.
   */
  async request(
    workspaceId: string,
    requestedBy: User,
    dto: RequestApprovalDto,
  ): Promise<Approval> {
    const approval = await this.workspaceContext.runForUser(
      requestedBy,
      async (tx) => {
        // If attached to a project, confirm it resolves under this workspace's
        // RLS scope before we hang an approval off it.
        if (dto.projectId) {
          const project = await tx.project.findUnique({
            where: { id: dto.projectId },
            select: { id: true },
          });
          if (!project) {
            throw new NotFoundException('Project not found');
          }
        }

        return tx.approval.create({
          data: {
            workspaceId,
            entityType: dto.entityType,
            entityId: dto.entityId,
            projectId: dto.projectId ?? null,
            approverContactId: dto.approverContactId ?? null,
            requestedById: requestedBy.id,
            status: ClientApprovalStatus.PENDING,
            note: dto.note ?? null,
          },
          include: { project: { select: this.projectSelect } },
        });
      },
      workspaceId,
    );

    await this.auditService.log({
      workspaceId,
      userId: requestedBy.id,
      projectId: dto.projectId,
      action: 'CREATE',
      resource: 'Approval',
      resourceId: approval.id,
      details: { entityType: dto.entityType, entityId: dto.entityId },
    });

    this.logger.log(
      `Approval ${approval.id} requested by ${requestedBy.id} ws=${workspaceId} (${dto.entityType}:${dto.entityId})`,
    );
    return approval;
  }

  // ----------------------------------------------------------------------
  // CLIENT: list my approvals
  // ----------------------------------------------------------------------

  /**
   * List the signed-in client's approvals (pending first, then most recent).
   * Scoped to the contact resolved from `user.id` and to the contact's own
   * projects (see class doc). `status` optionally filters (e.g. PENDING).
   */
  async listForContact(
    workspaceId: string,
    user: User,
    params?: {
      status?: ClientApprovalStatus;
      take?: number;
      skip?: number;
    },
  ): Promise<{ data: any[]; total: number }> {
    const { status, take, skip } = params || {};

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const contact = await this.requireContact(tx, user);
        const where = await this.ownedApprovalsWhere(tx, contact.id, status);

        const [rows, total] = await Promise.all([
          tx.approval.findMany({
            where,
            // PENDING surfaces first (it needs action), then newest activity.
            orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
            take: clampLimit(take, 50),
            skip: clampOffset(skip),
            include: { project: { select: this.projectSelect } },
          }),
          tx.approval.count({ where }),
        ]);

        return { data: rows.map((r) => this.transform(r)), total };
      },
      workspaceId,
    );
  }

  // ----------------------------------------------------------------------
  // CLIENT: decide an approval
  // ----------------------------------------------------------------------

  /**
   * Record a client's decision on ONE of their PENDING approvals.
   * Enforces (in order): workspace RLS → contact exists → the approval is the
   * client's (else 404) → it is still PENDING (else 409-style Forbidden). Stamps
   * status, decisionNote, decidedByContactId (the signed-in contact), decidedAt.
   */
  async decide(
    workspaceId: string,
    user: User,
    approvalId: string,
    dto: DecideApprovalDto,
  ): Promise<any> {
    const updated = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const contact = await this.requireContact(tx, user);

        // Load + ownership-check + state-check, then update — all in ONE
        // workspace tx so the decision is atomic under a single RLS scope.
        const approval = await tx.approval.findUnique({
          where: { id: approvalId },
          include: { project: { select: { id: true, contactId: true } } },
        });

        if (!approval || !this.isOwnedBy(approval, contact.id)) {
          // 404 (not 403) for rows outside the client's scope: never confirm
          // another org's approval exists.
          throw new NotFoundException('Approval not found');
        }

        if (approval.status !== ClientApprovalStatus.PENDING) {
          throw new ForbiddenException(
            'This approval has already been decided and can no longer be changed.',
          );
        }

        return tx.approval.update({
          where: { id: approvalId },
          data: {
            status: dto.decision,
            decisionNote: dto.note ?? null,
            decidedByContactId: contact.id,
            decidedAt: new Date(),
          },
          include: { project: { select: this.projectSelect } },
        });
      },
      workspaceId,
    );

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      projectId: updated.projectId ?? undefined,
      action: 'UPDATE',
      resource: 'Approval',
      resourceId: approvalId,
      details: { decision: dto.decision },
    });

    this.logger.log(
      `Approval ${approvalId} decided ${dto.decision} by contact (user=${user.id}) ws=${workspaceId}`,
    );
    return this.transform(updated);
  }

  // ----------------------------------------------------------------------
  // Internals
  // ----------------------------------------------------------------------

  private readonly projectSelect = {
    id: true,
    projectNumber: true,
    title: true,
  } as const;

  /** Resolve (and require) the portal Contact for the signed-in user. */
  private async requireContact(tx: WorkspaceTxClient, user: User) {
    const contact = await tx.contact.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contact profile not found');
    }
    return contact;
  }

  /**
   * Build the Prisma `where` that selects exactly the approvals owned by
   * `contactId` (optionally narrowed by status). Mirrors `isOwnedBy`:
   * addressed-to-this-contact OR (unaddressed AND on one of the contact's
   * projects). The project-id list keeps the query a single RLS-scoped read.
   */
  private async ownedApprovalsWhere(
    tx: WorkspaceTxClient,
    contactId: string,
    status?: ClientApprovalStatus,
  ): Promise<Prisma.ApprovalWhereInput> {
    const projects = await tx.project.findMany({
      where: { contactId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    return {
      ...(status ? { status } : {}),
      OR: [
        { approverContactId: contactId },
        ...(projectIds.length ? [{ approverContactId: null, projectId: { in: projectIds } }] : []),
      ],
    };
  }

  /**
   * True when `approval` is owned by `contactId`: either explicitly addressed
   * to that contact, or unaddressed and hanging off a project that contact owns.
   * Operates on an Approval joined with `project: { contactId }`.
   */
  private isOwnedBy(
    approval: Approval & { project?: { contactId: string | null } | null },
    contactId: string,
  ): boolean {
    if (approval.approverContactId) {
      return approval.approverContactId === contactId;
    }
    return approval.project?.contactId === contactId;
  }

  /** Shape an Approval row into the portal contract. */
  private transform(approval: any) {
    return {
      id: approval.id,
      entityType: approval.entityType,
      entityId: approval.entityId,
      projectId: approval.projectId,
      status: approval.status,
      note: approval.note,
      decisionNote: approval.decisionNote,
      decidedByContactId: approval.decidedByContactId,
      decidedAt: approval.decidedAt,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      project: approval.project ?? null,
    };
  }
}
