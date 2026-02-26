import axios, { AxiosProgressEvent } from 'axios';
import { api } from './api';

export interface UploadUrlResponse {
  uploadUrl: string;  // Backend returns 'uploadUrl'
  s3Key: string;      // Backend returns 's3Key'
  documentId: string; // Backend also returns documentId
}

export interface ConfirmUploadData {
  projectId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
}

export interface DocumentResponse {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  projectId?: string;
  uploadedById: string;
  createdAt: string;
}

/**
 * Request a presigned URL for uploading a file to MinIO
 */
export async function getUploadUrl(
  fileName: string,
  projectId: string | undefined,
  mimeType: string,
  fileSize: number
): Promise<UploadUrlResponse> {
  try {
    const payload: any = {
      fileName,
      mimeType,
      fileSize,
    };
    if (projectId) {
      payload.projectId = projectId;
    }
    const response = await api.post<UploadUrlResponse>('/documents/generate-upload-url', payload);
    return response.data;
  } catch (error) {
    console.error('Error getting upload URL:', error);
    throw new Error('Failed to get upload URL. Please try again.');
  }
}

/**
 * Upload file to MinIO using presigned URL
 */
export async function uploadToMinIO(
  file: File,
  presignedUrl: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  try {
    await axios.put(presignedUrl, file, {
      headers: {
        'Content-Type': file.type,
      },
      onUploadProgress: (progressEvent: AxiosProgressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percent);
        }
      },
    });
  } catch (error) {
    console.error('Error uploading to MinIO:', error);
    throw new Error('Failed to upload file. Please try again.');
  }
}

/**
 * Confirm upload to backend after successful MinIO upload
 */
export async function confirmUpload(data: ConfirmUploadData): Promise<DocumentResponse> {
  try {
    const response = await api.post<DocumentResponse>('/documents/confirm-upload', data);
    return response.data;
  } catch (error) {
    console.error('Error confirming upload:', error);
    throw new Error('Failed to confirm upload. Please try again.');
  }
}

/**
 * Get download URL for a document
 */
export async function getDownloadUrl(documentId: string): Promise<string> {
  try {
    const response = await api.get<{ downloadUrl: string }>(`/documents/${documentId}/download-url`);
    return response.data.downloadUrl;
  } catch (error) {
    console.error('Error getting download URL:', error);
    throw new Error('Failed to get download URL. Please try again.');
  }
}

/**
 * Upload file directly through backend proxy (bypasses CORS issues with presigned URLs)
 */
export async function uploadFile(
  file: File,
  projectId: string | undefined,
  onProgress?: (percent: number) => void
): Promise<DocumentResponse> {
  try {
    const formData = new FormData();
    formData.append('file', file);
    if (projectId) {
      formData.append('projectId', projectId);
    }

    const response = await api.post<DocumentResponse>('/documents/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        if (onProgress && progressEvent.total) {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          onProgress(percent);
        }
      },
    });

    return response.data;
  } catch (error) {
    console.error('Error in upload workflow:', error);
    throw new Error('Failed to upload file. Please try again.');
  }
}

/**
 * Validate file before upload
 */
export function validateFile(file: File): { valid: boolean; error?: string } {
  const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
  const ALLOWED_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'text/plain',
    'text/csv',
  ];

  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds 100MB limit. Your file is ${(file.size / 1024 / 1024).toFixed(2)}MB.`,
    };
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `File type not allowed. Please upload PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, TXT, or CSV files.`,
    };
  }

  return { valid: true };
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}
