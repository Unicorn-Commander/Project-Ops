import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { Comment, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private eventEmitter: EventEmitter2,
  ) {}

  async create(createCommentDto: CreateCommentDto, userId: string): Promise<any> {
    const comment = await this.prisma.comment.create({
      data: {
        ...createCommentDto,
        authorId: userId,
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
    });

    // Transform to match frontend expectations
    const transformedComment = {
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

    // Emit event for WebSocket broadcast
    this.eventEmitter.emit('comment.created', {
      projectId: comment.projectId,
      comment: transformedComment,
    });

    await this.auditService.log({
      userId,
      projectId: createCommentDto.projectId,
      action: 'CREATE',
      resource: 'Comment',
      resourceId: comment.id,
      details: { content: comment.content.substring(0, 100) },
    });

    this.logger.log(`Comment created on project ${createCommentDto.projectId} by user ${userId}`);
    return transformedComment;
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.CommentWhereInput;
    orderBy?: Prisma.CommentOrderByWithRelationInput;
  }): Promise<{ comments: any[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    const [comments, total] = await Promise.all([
      this.prisma.comment.findMany({
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
      this.prisma.comment.count({ where }),
    ]);

    // Transform to match frontend expectations
    const transformedComments = comments.map((comment) => ({
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
    }));

    return { comments: transformedComments, total };
  }

  async findOne(id: string): Promise<Comment> {
    const comment = await this.prisma.comment.findUnique({
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

  async findByProjectId(projectId: string): Promise<any[]> {
    const comments = await this.prisma.comment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
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
    });

    // Transform to match frontend expectations
    return comments.map((comment) => ({
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
    }));
  }

  async update(id: string, updateCommentDto: UpdateCommentDto, userId: string): Promise<any> {
    const comment = await this.prisma.comment.update({
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
    });

    // Transform to match frontend expectations
    const transformedComment = {
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

    // Emit event for WebSocket broadcast
    this.eventEmitter.emit('comment.updated', {
      projectId: comment.projectId,
      comment: transformedComment,
    });

    await this.auditService.log({
      userId,
      projectId: comment.projectId,
      action: 'UPDATE',
      resource: 'Comment',
      resourceId: id,
      details: updateCommentDto,
    });

    this.logger.log(`Comment ${id} updated by user ${userId}`);
    return transformedComment;
  }

  async remove(id: string, userId: string): Promise<Comment> {
    const comment = await this.findOne(id);

    const deletedComment = await this.prisma.comment.delete({
      where: { id },
    });

    // Emit event for WebSocket broadcast
    this.eventEmitter.emit('comment.deleted', {
      projectId: comment.projectId,
      commentId: id,
    });

    await this.auditService.log({
      userId,
      projectId: comment.projectId,
      action: 'DELETE',
      resource: 'Comment',
      resourceId: id,
    });

    this.logger.log(`Comment ${id} deleted by user ${userId}`);
    return deletedComment;
  }
}