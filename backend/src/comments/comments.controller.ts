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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '@prisma/client';

@ApiTags('comments')
@Controller('comments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new comment' })
  @ApiResponse({ status: 201, description: 'Comment created successfully' })
  create(@Body() createCommentDto: CreateCommentDto, @CurrentUser() user: User) {
    return this.commentsService.create(createCommentDto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all comments with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Returns list of comments' })
  async findAll(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('projectId') projectId?: string,
  ) {
    const skip = (page - 1) * limit;
    const where = projectId ? { projectId } : undefined;

    const { comments, total } = await this.commentsService.findAll({
      skip,
      take: limit,
      where,
      orderBy: { createdAt: 'desc' },
    });

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
  findByProjectId(@Param('projectId') projectId: string) {
    return this.commentsService.findByProjectId(projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get comment by ID' })
  @ApiResponse({ status: 200, description: 'Returns comment details' })
  @ApiResponse({ status: 404, description: 'Comment not found' })
  findOne(@Param('id') id: string) {
    return this.commentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update comment' })
  @ApiResponse({ status: 200, description: 'Comment updated successfully' })
  update(
    @Param('id') id: string,
    @Body() updateCommentDto: UpdateCommentDto,
    @CurrentUser() user: User,
  ) {
    return this.commentsService.update(id, updateCommentDto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete comment' })
  @ApiResponse({ status: 200, description: 'Comment deleted successfully' })
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.commentsService.remove(id, user.id);
  }
}