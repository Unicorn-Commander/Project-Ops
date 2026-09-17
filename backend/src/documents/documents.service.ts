import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService, WorkspaceTxClient } from '../prisma/prisma.service';
import { MinioService } from './minio.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { Document, Prisma, User, UserRole } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { WorkspaceContextService } from '../common/workspace/workspace-context.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * SUITE TENANCY (Phase 2, B4): every Document metadata read/write runs inside
 * `WorkspaceContextService.runForUser(user, tx => ..., workspaceId)` so the DB
 * RLS GUC scopes it to the active workspace. All document-row DB access goes
 * through the passed `tx`, never `this.prisma`.
 *
 * MinIO is an external object store with no row-level tenancy, so all MinIO I/O
 * (presign, upload, download stream, delete) is deliberately performed OUTSIDE
 * the workspace transaction — only the Prisma metadata reads/writes (and the
 * audit log) sit inside the runForUser callback. Where a MinIO op needs row
 * metadata first (download/view/delete), the row is fetched inside a tx, the
 * MinIO call runs outside it, and any follow-up write/audit runs inside a
 * second tx. Additive + inert while PROJECT_OPS_TENANCY_ENABLED is off
 * (membership resolution is a no-op and withWorkspace runs under the BYPASSRLS
 * owner connection).
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma: PrismaService,
    private minioService: MinioService,
    private auditService: AuditService,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async generatePresignedUploadUrl(
    workspaceId: string,
    user: User,
    projectId: string | undefined,
    fileName: string,
    fileSize: number,
  ): Promise<{ uploadUrl: string; documentId: string; s3Key: string }> {
    // Runtime validation: File size limit (100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

    if (!fileSize || fileSize <= 0) {
      this.logger.warn(`Invalid file size: ${fileSize} bytes for file ${fileName}`);
      throw new BadRequestException('File size must be greater than 0');
    }

    if (fileSize > MAX_FILE_SIZE) {
      this.logger.warn(
        `File size exceeds limit: ${fileSize} bytes (max: ${MAX_FILE_SIZE}) for file ${fileName}`,
      );
      throw new BadRequestException(
        `File size exceeds maximum allowed size of 100MB (${MAX_FILE_SIZE} bytes)`,
      );
    }

    // Generate unique S3 key
    const fileExtension = fileName.split('.').pop() || 'bin';
    const s3Key = projectId
      ? `projects/${projectId}/${uuidv4()}.${fileExtension}`
      : `unassigned/${uuidv4()}.${fileExtension}`;

    // MinIO presign runs OUTSIDE the workspace tx (no row-level tenancy).
    const uploadUrl = await this.minioService.getPresignedUploadUrl(s3Key, 3600);

    // Create document record with PENDING status (metadata write + audit inside the tx).
    const document = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const doc = await tx.document.create({
          data: {
            workspaceId,
            projectId: projectId || null,
            uploadedById: user.id,
            fileName,
            fileSize: 0, // Will be updated after upload
            mimeType: this.getMimeType(fileExtension),
            s3Key,
            s3Bucket: this.minioService.getBucketName(),
            status: 'PENDING',
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: projectId || undefined,
          action: 'CREATE',
          resource: 'Document',
          resourceId: doc.id,
          details: { fileName, s3Key },
        });

        return doc;
      },
      workspaceId,
    );

    this.logger.log(`Presigned upload URL generated for ${fileName}`);

    return {
      uploadUrl,
      documentId: document.id,
      s3Key,
    };
  }

  async confirmUpload(
    workspaceId: string,
    user: User,
    projectId: string | undefined,
    fileName: string,
    fileSize: number,
    mimeType: string,
    storagePath: string,
  ): Promise<Document> {
    // Runtime validation: File size limit (100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

    if (!fileSize || fileSize <= 0) {
      this.logger.warn(`Invalid file size: ${fileSize} bytes for file ${fileName}`);
      throw new BadRequestException('File size must be greater than 0');
    }

    if (fileSize > MAX_FILE_SIZE) {
      this.logger.warn(
        `File size exceeds limit: ${fileSize} bytes (max: ${MAX_FILE_SIZE}) for file ${fileName}`,
      );
      throw new BadRequestException(
        `File size exceeds maximum allowed size of 100MB (${MAX_FILE_SIZE} bytes)`,
      );
    }

    // Create document record after successful upload (metadata write + audit inside the tx).
    const document = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const doc = await tx.document.create({
          data: {
            workspaceId,
            projectId: projectId || null,
            uploadedById: user.id,
            fileName,
            fileSize,
            mimeType,
            s3Key: storagePath,
            s3Bucket: this.minioService.getBucketName(),
            status: 'UPLOADED',
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: projectId || undefined,
          action: 'UPDATE',
          resource: 'Document',
          resourceId: doc.id,
          details: { fileName, fileSize },
        });

        return doc;
      },
      workspaceId,
    );

    this.logger.log(`Document upload confirmed: ${document.fileName}`);
    return document;
  }

  async generatePresignedDownloadUrl(
    workspaceId: string,
    user: User,
    documentId: string,
  ): Promise<string> {
    // Fetch metadata inside the workspace tx (RLS-scoped); a doc in another
    // workspace resolves to NotFound under RLS.
    const document = await this.workspaceContext.runForUser(
      user,
      (tx) => this.findOneInTx(tx, documentId, user, workspaceId),
      workspaceId,
    );

    // MinIO presign runs OUTSIDE the tx.
    const downloadUrl = await this.minioService.getPresignedDownloadUrl(document.s3Key, 3600);

    // Audit the read inside a (second) workspace tx.
    await this.workspaceContext.runForUser(
      user,
      async () => {
        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: document.projectId || undefined,
          action: 'READ',
          resource: 'Document',
          resourceId: document.id,
          details: { fileName: document.fileName },
        });
      },
      workspaceId,
    );

    return downloadUrl;
  }

  async downloadFileProxy(
    workspaceId: string,
    user: User,
    documentId: string,
  ): Promise<{ stream: NodeJS.ReadableStream; fileName: string; mimeType: string; size: number }> {
    // Fetch metadata inside the workspace tx (RLS-scoped).
    const document = await this.workspaceContext.runForUser(
      user,
      (tx) => this.findOneInTx(tx, documentId, user, workspaceId),
      workspaceId,
    );

    // Get file stream from MinIO — OUTSIDE the tx.
    const stream = await this.minioService.getObjectStream(document.s3Key);

    // Audit the read inside a (second) workspace tx.
    await this.workspaceContext.runForUser(
      user,
      async () => {
        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: document.projectId || undefined,
          action: 'READ',
          resource: 'Document',
          resourceId: document.id,
          details: { fileName: document.fileName },
        });
      },
      workspaceId,
    );

    this.logger.log(`Document downloaded via proxy: ${document.fileName}`);

    return {
      stream,
      fileName: document.fileName,
      mimeType: document.mimeType,
      size: document.fileSize,
    };
  }

  async uploadFileProxy(
    workspaceId: string,
    user: User,
    file: Express.Multer.File,
    projectId: string | undefined,
  ): Promise<Document> {
    // Runtime validation: File size limit (100MB)
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

    if (!file.size || file.size <= 0) {
      this.logger.warn(`Invalid file size: ${file.size} bytes for file ${file.originalname}`);
      throw new BadRequestException('File size must be greater than 0');
    }

    if (file.size > MAX_FILE_SIZE) {
      this.logger.warn(
        `File size exceeds limit: ${file.size} bytes (max: ${MAX_FILE_SIZE}) for file ${file.originalname}`,
      );
      throw new BadRequestException(
        `File size exceeds maximum allowed size of 100MB (${MAX_FILE_SIZE} bytes)`,
      );
    }

    // Generate unique S3 key
    const fileExtension = file.originalname.split('.').pop() || 'bin';
    const s3Key = projectId
      ? `projects/${projectId}/${uuidv4()}.${fileExtension}`
      : `unassigned/${uuidv4()}.${fileExtension}`;

    // Upload file to MinIO — OUTSIDE the tx.
    await this.minioService.uploadObject(s3Key, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });

    // Create document record (metadata write + audit inside the tx).
    const document = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const doc = await tx.document.create({
          data: {
            workspaceId,
            projectId: projectId || null,
            uploadedById: user.id,
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            s3Key,
            s3Bucket: this.minioService.getBucketName(),
            status: 'UPLOADED',
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: projectId || undefined,
          action: 'CREATE',
          resource: 'Document',
          resourceId: doc.id,
          details: { fileName: file.originalname, fileSize: file.size },
        });

        return doc;
      },
      workspaceId,
    );

    this.logger.log(`Document uploaded via proxy: ${document.fileName}`);
    return document;
  }

  async create(
    workspaceId: string,
    user: User,
    createDocumentDto: CreateDocumentDto,
  ): Promise<Document> {
    const document = await this.workspaceContext.runForUser(
      user,
      (tx) =>
        tx.document.create({
          data: {
            ...createDocumentDto,
            workspaceId,
            uploadedById: user.id,
            s3Bucket: this.minioService.getBucketName(),
          },
          include: {
            project: true,
            uploadedBy: true,
          },
        }),
      workspaceId,
    );

    this.logger.log(`Document created: ${document.fileName}`);
    return document;
  }

  async findAll(
    workspaceId: string,
    user: User,
    params?: {
      skip?: number;
      take?: number;
      where?: Prisma.DocumentWhereInput;
      orderBy?: Prisma.DocumentOrderByWithRelationInput;
    },
  ): Promise<{ documents: Document[]; total: number }> {
    const { skip, take, where: requestedWhere, orderBy } = params || {};
    const where = { AND: [requestedWhere || {}, this.clientWhere(workspaceId, user)] };

    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const [documents, total] = await Promise.all([
          tx.document.findMany({
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
          tx.document.count({ where }),
        ]);

        return {
          documents:
            user.role === UserRole.CLIENT
              ? (documents.map((d) => this.clientDocument(d)) as Document[])
              : documents,
          total,
        };
      },
      workspaceId,
    );
  }

  async findOne(workspaceId: string, user: User, id: string): Promise<Document> {
    const doc = await this.workspaceContext.runForUser(
      user,
      (tx) => this.findOneInTx(tx, id, user, workspaceId),
      workspaceId,
    );
    return user.role === UserRole.CLIENT ? (this.clientDocument(doc) as Document) : doc;
  }

  /**
   * Fetch a single document inside an existing workspace tx so the read is
   * RLS-scoped to the active workspace. Shared by `findOne` and the MinIO flows
   * (download/view/delete) that need the row metadata before doing OUTSIDE-tx
   * object I/O. A document belonging to another workspace is invisible under
   * RLS and therefore surfaces as NotFound.
   */
  private async findOneInTx(
    tx: WorkspaceTxClient,
    id: string,
    user: User,
    workspaceId: string,
  ): Promise<Document> {
    const document = await tx.document.findUnique({
      where: { id, workspaceId },
      include: {
        project: true,
        uploadedBy: true,
      },
    });

    if (!document) {
      throw new NotFoundException(`Document with ID ${id} not found`);
    }

    if (user.role === UserRole.CLIENT) {
      const contact = await tx.contact.findUnique({
        where: {
          userId: user.id,
          workspaceId,
          isActive: true,
          portalAccessEnabled: true,
        },
      });
      if (
        !contact ||
        !document.isClientVisible ||
        document.status !== 'UPLOADED' ||
        document.project?.workspaceId !== workspaceId ||
        document.project?.contactId !== contact.id
      ) {
        throw new NotFoundException(`Document with ID ${id} not found`);
      }
    }
    return document;
  }

  async findByProjectId(workspaceId: string, user: User, projectId: string): Promise<Document[]> {
    return (
      await this.findAll(workspaceId, user, {
        where: { projectId },
        orderBy: { uploadedAt: 'desc' },
      })
    ).documents;
  }

  async update(
    workspaceId: string,
    user: User,
    id: string,
    updateDocumentDto: UpdateDocumentDto,
  ): Promise<Document> {
    return this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const document = await tx.document.update({
          where: { id },
          data: updateDocumentDto,
          include: {
            project: true,
            uploadedBy: true,
          },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: document.projectId || undefined,
          action: 'UPDATE',
          resource: 'Document',
          resourceId: id,
          details: updateDocumentDto,
        });

        this.logger.log(`Document updated: ${document.fileName}`);
        return document;
      },
      workspaceId,
    );
  }

  async remove(workspaceId: string, user: User, id: string): Promise<Document> {
    // Fetch metadata inside the workspace tx (RLS-scoped).
    const document = await this.workspaceContext.runForUser(
      user,
      (tx) => this.findOneInTx(tx, id, user, workspaceId),
      workspaceId,
    );

    // Delete from MinIO only if file was actually uploaded — OUTSIDE the tx.
    // For PENDING uploads with fileSize 0, the file doesn't exist in MinIO.
    if (document.status === 'UPLOADED' && document.fileSize > 0) {
      try {
        await this.minioService.deleteObject(document.s3Key);
        this.logger.log(`Deleted file from MinIO: ${document.s3Key}`);
      } catch (error) {
        this.logger.warn(
          `Failed to delete file from MinIO (may not exist): ${document.s3Key}`,
          error.message,
        );
        // Continue with database deletion even if MinIO delete fails
      }
    } else {
      this.logger.log(
        `Skipping MinIO deletion for document with status: ${document.status}, size: ${document.fileSize}`,
      );
    }

    // Delete the row + audit inside a (second) workspace tx.
    const deletedDocument = await this.workspaceContext.runForUser(
      user,
      async (tx) => {
        const deleted = await tx.document.delete({
          where: { id },
        });

        await this.auditService.log({
          workspaceId,
          userId: user.id,
          projectId: document.projectId || undefined,
          action: 'DELETE',
          resource: 'Document',
          resourceId: id,
          details: { fileName: document.fileName, status: document.status },
        });

        return deleted;
      },
      workspaceId,
    );

    this.logger.log(`Document deleted from database: ${document.fileName}`);
    return deletedDocument;
  }

  private clientDocument(doc: Document) {
    const { id, projectId, fileName, fileSize, mimeType, status, description, uploadedAt } = doc;
    return { id, projectId, fileName, fileSize, mimeType, status, description, uploadedAt };
  }

  private clientWhere(workspaceId: string, user: User): Prisma.DocumentWhereInput {
    return user.role === UserRole.CLIENT
      ? {
          workspaceId,
          isClientVisible: true,
          status: 'UPLOADED',
          project: {
            workspaceId,
            contact: { userId: user.id, workspaceId, isActive: true, portalAccessEnabled: true },
          },
        }
      : {};
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
