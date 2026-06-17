import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { Comment, Prisma, User } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { clampLimit, clampOffset } from '../common/pagination/clamp';

/**
 * Comments service.
 *
 * SUITE TENANCY (Phase 2, B3): every Comment read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. All comment-owned DB access goes
 * through the passed `tx`, never `this.prisma`. New rows stamp `workspaceId`.
 * The `workspaceId` is also threaded into every `audit.log()` call (R3) and the
 * emitted WebSocket events (so the realtime gateway can scope its broadcasts).
 * Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off (membership
 * resolution is a no-op and withWorkspace runs under the BYPASSRLS owner
 * connection).
 *
 * NOTE: the `comment.created/updated/deleted` listeners (websocket gateway)
 * only relay the already-fetched payload to a room; they do NOT re-query the
 * DB, so no unscoped read escapes the workspace tx.
 */
@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private prisma: PrismaService,
    private workspaceContext: WorkspaceContextService,
    private auditService: AuditService,
    private eventEmitter: EventEmitter2,
  ) {}

  /** Shape a raw Comment (with author) into the frontend contract. */
  private transform(comment: any) {
    return {
      id: comment.id,
      projectId: comment.projectId,
      userId: comment.authorId,
      content: comment.content,
      isInternal: comment.isInternal,
      createdAt: comment.createdAt,
      updatedAt: comment.updatedAt,
      user: {
        id: comment.author.id,
        name: `${comment.author.firstName} ${comment.author.lastName}`,
        email: comment.author.email,
      },
    };
  }

  async create(
    workspaceId: string,
    user: User,
    createCommentDto: CreateCommentDto,
  ): Promise<any> {
    const comment = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.comment.create({
          data: {
            ...createCommentDto,
            workspaceId,
            authorId: user.id,
          },
          include: {
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            project: {
              select: {
                id: true,
                projectNumber: true,
                title: true,
              },
            },
          },
        }),
      workspaceId,
    );

    // Transform to match frontend expectations
    const transformedComment = this.transform(comment);

    // Emit event for WebSocket broadcast (workspace-scoped; listener only relays)
    this.eventEmitter.emit('comment.created', {
      workspaceId,
      projectId: comment.projectId,
      comment: transformedComment,
    });

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      projectId: createCommentDto.projectId,
      action: 'CREATE',
      resource: 'Comment',
      resourceId: comment.id,
      details: { content: comment.content.substring(0, 100) },
    });

    this.logger.log(
      `Comment created on project ${createCommentDto.projectId} by user ${user.id} ws=${workspaceId}`,
    );
    return transformedComment;
  }

  async findAll(
    workspaceId: string,
    user: User,
    params?: {
      skip?: number;
      take?: number;
      where?: Prisma.CommentWhereInput;
      orderBy?: Prisma.CommentOrderByWithRelationInput;
    },
  ): Promise<{ comments: any[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    const { comments, total } = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [rows, count] = await Promise.all([
          tx.comment.findMany({
            skip,
            take,
            where,
            orderBy,
            include: {
              author: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
              project: {
                select: {
                  id: true,
                  projectNumber: true,
                  title: true,
                },
              },
            },
          }),
          tx.comment.count({ where }),
        ]);
        return { comments: rows, total: count };
      },
      workspaceId,
    );

    // Transform to match frontend expectations
    const transformedComments = comments.map((comment) => this.transform(comment));

    return { comments: transformedComments, total };
  }

  async findOne(workspaceId: string, user: User, id: string): Promise<Comment> {
    return this.workspaceContext.runForUser(
      user,
      (tx) => this.findOneInTx(tx, id),
      workspaceId,
    );
  }

  /**
   * Load one comment inside an existing workspace tx. Shared by `findOne` and
   * `remove` so the delete runs in ONE workspace-scoped transaction (and one
   * membership authorization). Reads via the passed `tx` → RLS-scoped.
   */
  private async findOneInTx(
    tx: WorkspaceTxClient,
    id: string,
  ): Promise<Comment> {
    const comment = await tx.comment.findUnique({
      where: { id },
      include: {
        author: true,
        project: true,
      },
    });

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    return comment;
  }

  async findByProjectId(
    workspaceId: string,
    user: User,
    projectId: string,
    params?: {
      skip?: number;
      take?: number;
    },
  ): Promise<any[]> {
    // Pagination guardrail: this used to `findMany` with no bound, so a project
    // with thousands of comments loaded them all in one shot. `take`/`skip` are
    // clamped at the controller; we apply sane fallbacks here too so any other
    // caller (e.g. a service-to-service path) is still bounded.
    const { skip, take } = params || {};

    const comments = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.comment.findMany({
          where: { projectId },
          orderBy: { createdAt: 'desc' },
          skip: clampOffset(skip),
          take: clampLimit(take, 50),
          include: {
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
      workspaceId,
    );

    // Transform to match frontend expectations
    return comments.map((comment) => this.transform(comment));
  }

  async update(
    workspaceId: string,
    user: User,
    id: string,
    updateCommentDto: UpdateCommentDto,
  ): Promise<any> {
    const comment = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.comment.update({
          where: { id },
          data: updateCommentDto,
          include: {
            author: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            project: {
              select: {
                id: true,
                projectNumber: true,
                title: true,
              },
            },
          },
        }),
      workspaceId,
    );

    // Transform to match frontend expectations
    const transformedComment = this.transform(comment);

    // Emit event for WebSocket broadcast (workspace-scoped; listener only relays)
    this.eventEmitter.emit('comment.updated', {
      workspaceId,
      projectId: comment.projectId,
      comment: transformedComment,
    });

    await this.auditService.log({
      workspaceId,
      userId: user.id,
      projectId: comment.projectId,
      action: 'UPDATE',
      resource: 'Comment',
      resourceId: id,
      details: updateCommentDto,
    });

    this.logger.log(`Comment ${id} updated by user ${user.id} ws=${workspaceId}`);
    return transformedComment;
  }

  async remove(workspaceId: string, user: User, id: string): Promise<Comment> {
    const deletedComment = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        // Load (and existence-check) + delete in ONE workspace tx so both run
        // under the same RLS scope and membership authorization.
        const comment = await this.findOneInTx(tx, id);
        const deleted = await tx.comment.delete({
          where: { id },
        });

        // Emit event for WebSocket broadcast (workspace-scoped; listener only relays)
        this.eventEmitter.emit('comment.deleted', {
          workspaceId,
          projectId: comment.projectId,
          commentId: id,
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: comment.projectId,
          action: 'DELETE',
          resource: 'Comment',
          resourceId: id,
        });

        return deleted;
      },
      workspaceId,
    );

    this.logger.log(`Comment ${id} deleted by user ${user.id} ws=${workspaceId}`);
    return deletedComment;
  }
}
