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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User, DocumentStatus } from '@prisma/client';

@ApiTags('documents')
@Controller('documents')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('generate-upload-url')
  @ApiOperation({ summary: 'Generate presigned URL for document upload' })
  @ApiResponse({ status: 200, description: 'Returns presigned upload URL' })
  @ApiResponse({ status: 400, description: 'File size exceeds limit or invalid parameters' })
  @ApiResponse({ status: 500, description: 'Failed to generate upload URL' })
  async generateUploadUrl(
    @Body() generateUploadUrlDto: GenerateUploadUrlDto,
    @CurrentUser() user: User,
  ) {
    try {
      return await this.documentsService.generatePresignedUploadUrl(
        generateUploadUrlDto.projectId,
        generateUploadUrlDto.fileName,
        generateUploadUrlDto.fileSize,
        user.id,
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
    @Body() confirmUploadDto: ConfirmUploadDto,
    @CurrentUser() user: User,
  ) {
    try {
      return await this.documentsService.confirmUpload(
        confirmUploadDto.projectId,
        confirmUploadDto.fileName,
        confirmUploadDto.fileSize,
        confirmUploadDto.mimeType,
        confirmUploadDto.storagePath,
        user.id,
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
    @UploadedFile() file: Express.Multer.File,
    @Body('projectId') projectId: string | undefined,
    @CurrentUser() user: User,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return await this.documentsService.uploadFileProxy(
      file,
      projectId,
      user.id,
    );
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Generate presigned URL for document download' })
  @ApiResponse({ status: 200, description: 'Returns presigned download URL' })
  async generateDownloadUrl(@Param('id') id: string, @CurrentUser() user: User) {
    const url = await this.documentsService.generatePresignedDownloadUrl(id, user.id);
    return { url };  // Return as 'url' not 'downloadUrl' to match frontend expectation
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download document directly through backend proxy' })
  @ApiResponse({ status: 200, description: 'Returns file stream' })
  async downloadFile(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const { stream, fileName, mimeType, size } = await this.documentsService.downloadFileProxy(id, user.id);

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
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const { stream, fileName, mimeType, size } = await this.documentsService.downloadFileProxy(id, user.id);

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
  create(@Body() createDocumentDto: CreateDocumentDto, @CurrentUser() user: User) {
    return this.documentsService.create(createDocumentDto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all documents with pagination' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'projectId', required: false, type: String })
  @ApiQuery({ name: 'status', required: false, enum: DocumentStatus })
  @ApiResponse({ status: 200, description: 'Returns list of documents' })
  async findAll(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 20,
    @Query('projectId') projectId?: string,
    @Query('status') status?: DocumentStatus,
  ) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (projectId) where.projectId = projectId;
    if (status) where.status = status;

    const { documents, total } = await this.documentsService.findAll({
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
  findByProjectId(@Param('projectId') projectId: string) {
    return this.documentsService.findByProjectId(projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get document by ID' })
  @ApiResponse({ status: 200, description: 'Returns document details' })
  @ApiResponse({ status: 404, description: 'Document not found' })
  findOne(@Param('id') id: string) {
    return this.documentsService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update document' })
  @ApiResponse({ status: 200, description: 'Document updated successfully' })
  update(
    @Param('id') id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @CurrentUser() user: User,
  ) {
    return this.documentsService.update(id, updateDocumentDto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete document' })
  @ApiResponse({ status: 200, description: 'Document deleted successfully' })
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.remove(id, user.id);
  }
}