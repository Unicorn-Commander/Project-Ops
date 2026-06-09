import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { User } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, B3): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all DB access inside that workspace's RLS tx.
 */
@ApiTags('comments')
@Controller('comments')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new comment' })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.commentsService.create(workspaceId, user, createCommentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all comments with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns list of comments' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('projectId') projectId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where = projectId ? { projectId } : undefined;

    const { comments, total } = await this.commentsService.findAll(
      workspaceId,
      user,
      {
        skip,
        take: limit,
        where,
        orderBy: { createdAt: 'desc' },
      },
    );

    return {
      data: comments,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get all comments for a project' })
  @ApiResponse({ status: 200, description: 'Returns project comments' })
  findByProjectId(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
  ) {
    return this.commentsService.findByProjectId(workspaceId, user, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get comment by ID' })
  @ApiResponse({ status: 200, description: 'Returns comment details' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.commentsService.findOne(workspaceId, user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update comment' })
  @ApiResponse({ status: 200, description: 'Comment updated successfully' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateCommentDto: UpdateCommentDto,
  ) {
    return this.commentsService.update(workspaceId, user, id, updateCommentDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete comment' })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.commentsService.remove(workspaceId, user, id);
  }
}
