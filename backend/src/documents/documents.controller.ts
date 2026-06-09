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
  BadRequestException,
  InternalServerErrorException,
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { GenerateUploadUrlDto } from './dto/generate-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../common/workspace/current-workspace.decorator';
import { WorkspaceMembershipGuard } from '../common/workspace/workspace-membership.guard';
import { User, DocumentStatus } from '@prisma/client';

/**
 * Suite tenancy (Phase 2, B4): every route resolves the active workspace via
 * @CurrentWorkspace + WorkspaceMembershipGuard and passes (workspaceId, user)
 * into the service, which runs all Document metadata access inside that
 * workspace's RLS tx. MinIO object I/O stays outside the tx (see the service).
 */
@ApiTags('documents')
@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard, WorkspaceMembershipGuard)
@ApiBearerAuth('JWT-auth')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('generate-upload-url')
  @ApiOperation({ summary: 'Generate presigned URL for document upload' })
  @ApiResponse({ status: 200, description: 'Returns presigned upload URL' })
  @ApiResponse({ status: 400, description: 'File size exceeds limit or invalid parameters' })
  @ApiResponse({ status: 500, description: 'Failed to generate upload URL' })
  async generateUploadUrl(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() generateUploadUrlDto: GenerateUploadUrlDto,
  ) {
    try {
      return await this.documentsService.generatePresignedUploadUrl(
        workspaceId,
        user,
        generateUploadUrlDto.projectId,
        generateUploadUrlDto.fileName,
        generateUploadUrlDto.fileSize,
      );
    } catch (error) {
      // Re-throw if already an HTTP exception
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      // Otherwise wrap in InternalServerErrorException
      throw new InternalServerErrorException(`Failed to generate upload URL: ${error.message}`);
    }
  }

  @Post('confirm-upload')
  @ApiOperation({ summary: 'Confirm document upload completion' })
  @ApiResponse({ status: 200, description: 'Document upload confirmed' })
  @ApiResponse({ status: 400, description: 'Invalid upload data or file size exceeds limit' })
  @ApiResponse({ status: 500, description: 'Failed to confirm upload' })
  async confirmUpload(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() confirmUploadDto: ConfirmUploadDto,
  ) {
    try {
      return await this.documentsService.confirmUpload(
        workspaceId,
        user,
        confirmUploadDto.projectId,
        confirmUploadDto.fileName,
        confirmUploadDto.fileSize,
        confirmUploadDto.mimeType,
        confirmUploadDto.storagePath,
      );
    } catch (error) {
      // Re-throw if already an HTTP exception
      if (error instanceof BadRequestException || error instanceof InternalServerErrorException) {
        throw error;
      }
      // Otherwise wrap in InternalServerErrorException
      throw new InternalServerErrorException(`Failed to confirm upload: ${error.message}`);
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload document directly through backend proxy' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        projectId: {
          type: 'string',
          description: 'Optional project ID',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Document uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or size exceeds limit' })
  async uploadFile(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return await this.documentsService.uploadFileProxy(
      workspaceId,
      user,
      file,
      projectId,
    );
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Generate presigned URL for document download' })
  @ApiResponse({ status: 200, description: 'Returns presigned download URL' })
  async generateDownloadUrl(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    const url = await this.documentsService.generatePresignedDownloadUrl(workspaceId, user, id);
    return { url };  // Return as 'url' not 'downloadUrl' to match frontend expectation
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download document directly through backend proxy' })
  @ApiResponse({ status: 200, description: 'Returns file stream' })
  async downloadFile(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { stream, fileName, mimeType, size } = await this.documentsService.downloadFileProxy(workspaceId, user, id);

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': size,
    });

    stream.pipe(res);
  }

  @Get(':id/view')
  @ApiOperation({ summary: 'View document in browser (inline display)' })
  @ApiResponse({ status: 200, description: 'Returns file stream for inline viewing' })
  async viewFile(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { stream, fileName, mimeType, size } = await this.documentsService.downloadFileProxy(workspaceId, user, id);

    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': size,
    });

    stream.pipe(res);
  }

  @Post()
  @ApiOperation({ summary: 'Create document record (alternative flow)' })
  @ApiResponse({ status: 201, description: 'Document created successfully' })
  create(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Body() createDocumentDto: CreateDocumentDto,
  ) {
    return this.documentsService.create(workspaceId, user, createDocumentDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all documents with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: DocumentStatus })
  @ApiResponse({ status: 200, description: 'Returns list of documents' })
  async findAll(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('projectId') projectId?: string,
    @Query('status') status?: DocumentStatus,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const { documents, total } = await this.documentsService.findAll(workspaceId, user, {
      skip,
      take: limit,
      where,
      orderBy: { uploadedAt: 'desc' },
    });

    return {
      data: documents,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('project/:projectId')
  @ApiOperation({ summary: 'Get all documents for a project' })
  @ApiResponse({ status: 200, description: 'Returns project documents' })
  findByProjectId(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('projectId') projectId: string,
  ) {
    return this.documentsService.findByProjectId(workspaceId, user, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document by ID' })
  @ApiResponse({ status: 200, description: 'Returns document details' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  findOne(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.documentsService.findOne(workspaceId, user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update document' })
  @ApiResponse({ status: 200, description: 'Document updated successfully' })
  update(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
  ) {
    return this.documentsService.update(workspaceId, user, id, updateDocumentDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete document' })
  @ApiResponse({ status: 200, description: 'Document deleted successfully' })
  remove(
    @CurrentWorkspace() workspaceId: string,
    @CurrentUser() user: User,
    @Param('id') id: string,
  ) {
    return this.documentsService.remove(workspaceId, user, id);
  }
}
