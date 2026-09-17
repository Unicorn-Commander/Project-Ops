import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient: Minio.Client;
  private signingClient: Minio.Client;
  private bucketName: string;

  // Public endpoint configuration for presigned URLs
  private publicEndpoint: string;
  private publicPort: number;
  private publicUseSSL: boolean;

  // Internal endpoint configuration
  private internalEndpoint: string;
  private internalPort: number;

  constructor(private configService: ConfigService) {
    // Internal MinIO client configuration (for Docker network)
    this.internalEndpoint = this.configService.get('MINIO_ENDPOINT', 'localhost');
    this.internalPort = parseInt(this.configService.get('MINIO_PORT', '9000'));
    const internalUseSSL = this.configService.get('MINIO_USE_SSL', 'false') === 'true';

    this.minioClient = new Minio.Client({
      endPoint: this.internalEndpoint,
      port: this.internalPort,
      useSSL: internalUseSSL,
      accessKey: this.configService.get('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: this.configService.get('MINIO_SECRET_KEY', 'minioadmin'),
    });

    this.bucketName = this.configService.get('MINIO_BUCKET_NAME', 'project-ops-documents');

    // Public endpoint configuration (for presigned URLs accessible from browser)
    this.publicEndpoint = this.configService.get('MINIO_PUBLIC_ENDPOINT', this.internalEndpoint);
    this.publicPort = parseInt(
      this.configService.get('MINIO_PUBLIC_PORT', this.internalPort.toString()),
    );
    this.publicUseSSL = this.configService.get('MINIO_PUBLIC_USE_SSL', 'false') === 'true';

    // SigV4 signs Host. Generate against the public endpoint rather than
    // rewriting an internal signed URL (which invalidates its signature).
    // A configured region avoids a public-network bucket-region probe.
    this.signingClient = new Minio.Client({
      endPoint: this.publicEndpoint,
      port: this.publicPort,
      useSSL: this.publicUseSSL,
      accessKey: this.configService.get('MINIO_ACCESS_KEY', 'minioadmin'),
      secretKey: this.configService.get('MINIO_SECRET_KEY', 'minioadmin'),
      region: this.configService.get('MINIO_REGION', 'us-east-1'),
    });

    this.logger.log(
      `MinIO configured - Internal: ${internalUseSSL ? 'https' : 'http'}://${this.internalEndpoint}:${this.internalPort}`,
    );
    this.logger.log(
      `MinIO configured - Public: ${this.publicUseSSL ? 'https' : 'http'}://${this.publicEndpoint}:${this.publicPort}`,
    );
  }

  async onModuleInit() {
    try {
      const exists = await this.minioClient.bucketExists(this.bucketName);
      if (!exists) {
        await this.minioClient.makeBucket(this.bucketName, 'us-east-1');
        this.logger.log(`Bucket ${this.bucketName} created`);
      }
      this.logger.log('MinIO connection established');
    } catch (error) {
      this.logger.error('Failed to initialize MinIO', error);
    }
  }

  async getPresignedUploadUrl(objectName: string, expirySeconds: number = 3600): Promise<string> {
    try {
      const url = await this.signingClient.presignedPutObject(
        this.bucketName,
        objectName,
        expirySeconds,
      );
      this.logger.log(`Generated presigned upload URL for: ${objectName}`);
      return url;
    } catch (error) {
      this.logger.error('Failed to generate presigned upload URL', error);
      throw error;
    }
  }

  async getPresignedDownloadUrl(objectName: string, expirySeconds: number = 3600): Promise<string> {
    try {
      const url = await this.signingClient.presignedGetObject(
        this.bucketName,
        objectName,
        expirySeconds,
      );
      this.logger.log(`Generated presigned download URL for: ${objectName}`);
      return url;
    } catch (error) {
      this.logger.error('Failed to generate presigned download URL', error);
      throw error;
    }
  }

  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucketName, objectName);
      this.logger.log(`Object ${objectName} deleted`);
    } catch (error) {
      this.logger.error('Failed to delete object', error);
      throw error;
    }
  }

  async uploadObject(
    objectName: string,
    stream: Buffer | ReadableStream,
    size?: number,
    metaData?: Minio.ItemBucketMetadata,
  ): Promise<Minio.UploadedObjectInfo> {
    try {
      // Convert ReadableStream to Buffer if needed
      const buffer = stream instanceof Buffer ? stream : await this.streamToBuffer(stream as any);

      const result = await this.minioClient.putObject(
        this.bucketName,
        objectName,
        buffer,
        size,
        metaData,
      );
      this.logger.log(`Object ${objectName} uploaded`);
      return result;
    } catch (error) {
      this.logger.error('Failed to upload object', error);
      throw error;
    }
  }

  private async streamToBuffer(stream: any): Promise<Buffer> {
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getObjectStream(objectName: string): Promise<NodeJS.ReadableStream> {
    try {
      const stream = await this.minioClient.getObject(this.bucketName, objectName);
      this.logger.log(`Object stream retrieved: ${objectName}`);
      return stream;
    } catch (error) {
      this.logger.error('Failed to get object stream', error);
      throw error;
    }
  }

  async getObjectStat(objectName: string): Promise<Minio.BucketItemStat> {
    try {
      return await this.minioClient.statObject(this.bucketName, objectName);
    } catch (error) {
      this.logger.error('Failed to get object stat', error);
      throw error;
    }
  }

  getBucketName(): string {
    return this.bucketName;
  }
}
