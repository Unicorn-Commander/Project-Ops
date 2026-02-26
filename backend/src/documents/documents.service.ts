import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MinioService } from './minio.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { Document, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
    private auditService: AuditService,
  ) {}

  async generatePresignedUploadUrl(
    projectId: string | undefined,
    fileName: string,
    fileSize: number,
    userId: string,
  ): Promise<{ uploadUrl: string; documentId: string; s3Key: string }> {
    // Runtime validation: File size limit (100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

    if (!fileSize || fileSize <= 0) {
      this.logger.warn(`Invalid file size: ${fileSize} bytes for file ${fileName}`);
      throw new BadRequestException('File size must be greater than 0');
    }

    if (fileSize > MAX_FILE_SIZE) {
      this.logger.warn(`File size exceeds limit: ${fileSize} bytes (max: ${MAX_FILE_SIZE}) for file ${fileName}`);
      throw new BadRequestException(`File size exceeds maximum allowed size of 100MB (${MAX_FILE_SIZE} bytes)`);
    }

    // Generate unique S3 key
    const fileExtension = fileName.split('.').pop() || 'bin';
    const s3Key = projectId
      ? `projects/${projectId}/${uuidv4()}.${fileExtension}`
      : `unassigned/${uuidv4()}.${fileExtension}`;

    // Get presigned URL for upload
    const uploadUrl = await this.minioService.getPresignedUploadUrl(s3Key, 3600);

    // Create document record with PENDING status
    const document = await this.prisma.document.create({
      data: {
        projectId: projectId || null,
        uploadedById: userId,
        fileName,
        fileSize: 0, // Will be updated after upload
        mimeType: this.getMimeType(fileExtension),
        s3Key,
        s3Bucket: this.minioService.getBucketName(),
        status: 'PENDING',
      },
    });

    await this.auditService.log({
      userId,
      projectId: projectId || undefined,
      action: 'CREATE',
      resource: 'Document',
      resourceId: document.id,
      details: { fileName, s3Key },
    });

    this.logger.log(`Presigned upload URL generated for ${fileName}`);

    return {
      uploadUrl,
      documentId: document.id,
      s3Key,
    };
  }

  async confirmUpload(
    projectId: string | undefined,
    fileName: string,
    fileSize: number,
    mimeType: string,
    storagePath: string,
    userId: string,
  ): Promise<Document> {
    // Runtime validation: File size limit (100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

    if (!fileSize || fileSize <= 0) {
      this.logger.warn(`Invalid file size: ${fileSize} bytes for file ${fileName}`);
      throw new BadRequestException('File size must be greater than 0');
    }

    if (fileSize > MAX_FILE_SIZE) {
      this.logger.warn(`File size exceeds limit: ${fileSize} bytes (max: ${MAX_FILE_SIZE}) for file ${fileName}`);
      throw new BadRequestException(`File size exceeds maximum allowed size of 100MB (${MAX_FILE_SIZE} bytes)`);
    }

    // Create document record after successful upload
    const document = await this.prisma.document.create({
      data: {
        projectId: projectId || null,
        uploadedById: userId,
        fileName,
        fileSize,
        mimeType,
        s3Key: storagePath,
        s3Bucket: this.minioService.getBucketName(),
        status: 'UPLOADED',
      },
    });

    await this.auditService.log({
      userId,
      projectId: projectId || undefined,
      action: 'UPDATE',
      resource: 'Document',
      resourceId: document.id,
      details: { fileName, fileSize },
    });

    this.logger.log(`Document upload confirmed: ${document.fileName}`);
    return document;
  }

  async generatePresignedDownloadUrl(documentId: string, userId: string): Promise<string> {
    const document = await this.findOne(documentId);

    const downloadUrl = await this.minioService.getPresignedDownloadUrl(document.s3Key, 3600);

    await this.auditService.log({
      userId,
      projectId: document.projectId || undefined,
      action: 'READ',
      resource: 'Document',
      resourceId: document.id,
      details: { fileName: document.fileName },
    });

    return downloadUrl;
  }

  async downloadFileProxy(
    documentId: string,
    userId: string,
  ): Promise<{ stream: NodeJS.ReadableStream; fileName: string; mimeType: string; size: number }> {
    const document = await this.findOne(documentId);

    // Get file stream from MinIO
    const stream = await this.minioService.getObjectStream(document.s3Key);

    await this.auditService.log({
      userId,
      projectId: document.projectId || undefined,
      action: 'READ',
      resource: 'Document',
      resourceId: document.id,
      details: { fileName: document.fileName },
    });

    this.logger.log(`Document downloaded via proxy: ${document.fileName}`);

    return {
      stream,
      fileName: document.fileName,
      mimeType: document.mimeType,
      size: document.fileSize,
    };
  }

  async uploadFileProxy(
    file: Express.Multer.File,
    projectId: string | undefined,
    userId: string,
  ): Promise<Document> {
    // Runtime validation: File size limit (100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

    if (!file.size || file.size <= 0) {
      this.logger.warn(`Invalid file size: ${file.size} bytes for file ${file.originalname}`);
      throw new BadRequestException('File size must be greater than 0');
    }

    if (file.size > MAX_FILE_SIZE) {
      this.logger.warn(`File size exceeds limit: ${file.size} bytes (max: ${MAX_FILE_SIZE}) for file ${file.originalname}`);
      throw new BadRequestException(`File size exceeds maximum allowed size of 100MB (${MAX_FILE_SIZE} bytes)`);
    }

    // Generate unique S3 key
    const fileExtension = file.originalname.split('.').pop() || 'bin';
    const s3Key = projectId
      ? `projects/${projectId}/${uuidv4()}.${fileExtension}`
      : `unassigned/${uuidv4()}.${fileExtension}`;

    // Upload file to MinIO
    await this.minioService.uploadObject(s3Key, file.buffer, file.size, { 'Content-Type': file.mimetype });

    // Create document record
    const document = await this.prisma.document.create({
      data: {
        projectId: projectId || null,
        uploadedById: userId,
        fileName: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        s3Key,
        s3Bucket: this.minioService.getBucketName(),
        status: 'UPLOADED',
      },
    });

    await this.auditService.log({
      userId,
      projectId: projectId || undefined,
      action: 'CREATE',
      resource: 'Document',
      resourceId: document.id,
      details: { fileName: file.originalname, fileSize: file.size },
    });

    this.logger.log(`Document uploaded via proxy: ${document.fileName}`);
    return document;
  }

  async create(createDocumentDto: CreateDocumentDto, userId: string): Promise<Document> {
    const document = await this.prisma.document.create({
      data: {
        ...createDocumentDto,
        uploadedById: userId,
        s3Bucket: this.minioService.getBucketName(),
      },
      include: {
        project: true,
        uploadedBy: true,
      },
    });

    this.logger.log(`Document created: ${document.fileName}`);
    return document;
  }

  async findAll(params?: {
    skip?: number;
    take?: number;
    where?: Prisma.DocumentWhereInput;
    orderBy?: Prisma.DocumentOrderByWithRelationInput;
  }): Promise<{ documents: Document[]; total: number }> {
    const { skip, take, where, orderBy } = params || {};

    const [documents, total] = await Promise.all([
      this.prisma.document.findMany({
        skip,
        take,
        where,
        orderBy,
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
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { documents, total };
  }

  async findOne(id: string): Promise<Document> {
    const document = await this.prisma.document.findUnique({
      where: { id },
      include: {
        project: true,
        uploadedBy: true,
      },
    });

    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }

    return document;
  }

  async findByProjectId(projectId: string): Promise<Document[]> {
    return this.prisma.document.findMany({
      where: { projectId },
      orderBy: { uploadedAt: 'desc' },
      include: {
        uploadedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });
  }

  async update(id: string, updateDocumentDto: UpdateDocumentDto, userId: string): Promise<Document> {
    const document = await this.prisma.document.update({
      where: { id },
      data: updateDocumentDto,
      include: {
        project: true,
        uploadedBy: true,
      },
    });

    await this.auditService.log({
      userId,
      projectId: document.projectId || undefined,
      action: 'UPDATE',
      resource: 'Document',
      resourceId: id,
      details: updateDocumentDto,
    });

    this.logger.log(`Document updated: ${document.fileName}`);
    return document;
  }

  async remove(id: string, userId: string): Promise<Document> {
    const document = await this.findOne(id);

    // Delete from MinIO only if file was actually uploaded
    // For PENDING uploads with fileSize 0, the file doesn't exist in MinIO
    if (document.status === 'UPLOADED' && document.fileSize > 0) {
      try {
        await this.minioService.deleteObject(document.s3Key);
        this.logger.log(`Deleted file from MinIO: ${document.s3Key}`);
      } catch (error) {
        this.logger.warn(`Failed to delete file from MinIO (may not exist): ${document.s3Key}`, error.message);
        // Continue with database deletion even if MinIO delete fails
      }
    } else {
      this.logger.log(`Skipping MinIO deletion for document with status: ${document.status}, size: ${document.fileSize}`);
    }

    // Delete from database
    const deletedDocument = await this.prisma.document.delete({
      where: { id },
    });

    await this.auditService.log({
      userId,
      projectId: document.projectId || undefined,
      action: 'DELETE',
      resource: 'Document',
      resourceId: id,
      details: { fileName: document.fileName, status: document.status },
    });

    this.logger.log(`Document deleted from database: ${document.fileName}`);
    return deletedDocument;
  }

  private getMimeType(extension: string): string {
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      txt: 'text/plain',
      csv: 'text/csv',
    };

    return mimeTypes[extension?.toLowerCase()] || 'application/octet-stream';
  }
}