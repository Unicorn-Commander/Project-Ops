"use client"

import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import DropZone from '@/components/file-upload/drop-zone';
import FileList, { FileItem } from '@/components/file-upload/file-list';
import UploadProgress from '@/components/file-upload/upload-progress';
import { uploadFile, DocumentResponse } from '@/lib/upload-service';
import { useToast } from '@/components/ui/use-toast';

export interface UploadDocumentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  onUploadComplete?: (documents: DocumentResponse[]) => void;
}

interface UploadingFile extends FileItem {
  progress: number;
  status: 'uploading' | 'success' | 'error';
  error?: string;
  document?: DocumentResponse;
}

const UploadDocumentsModal: React.FC<UploadDocumentsModalProps> = ({
  isOpen,
  onClose,
  projectId,
  onUploadComplete,
}) => {
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleFilesSelected = useCallback((files: File[]) => {
    const newFiles: FileItem[] = files.map((file) => ({
      file,
      id: `${file.name}-${Date.now()}-${Math.random()}`,
    }));
    setSelectedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);

    // Initialize uploading files state
    const filestoUpload: UploadingFile[] = selectedFiles.map((fileItem) => ({
      ...fileItem,
      progress: 0,
      status: 'uploading' as const,
    }));

    setUploadingFiles(filestoUpload);
    setSelectedFiles([]);

    // Upload files sequentially (can be modified for parallel uploads)
    const uploadedDocuments: DocumentResponse[] = [];

    for (let i = 0; i < filestoUpload.length; i++) {
      const fileItem = filestoUpload[i];

      try {
        const document = await uploadFile(fileItem.file, projectId, (progress) => {
          setUploadingFiles((prev) =>
            prev.map((f, idx) =>
              idx === i ? { ...f, progress } : f
            )
          );
        });

        // Mark as success
        setUploadingFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'success' as const, progress: 100, document }
              : f
          )
        );

        uploadedDocuments.push(document);

        toast({
          title: 'Upload successful',
          description: `${fileItem.file.name} uploaded successfully`,
        });
      } catch (error) {
        // Mark as error
        setUploadingFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? {
                  ...f,
                  status: 'error' as const,
                  error: error instanceof Error ? error.message : 'Upload failed',
                }
              : f
          )
        );

        toast({
          title: 'Upload failed',
          description: `Failed to upload ${fileItem.file.name}`,
          variant: 'destructive',
        });
      }
    }

    setIsUploading(false);

    // Call onUploadComplete with successfully uploaded documents
    if (uploadedDocuments.length > 0 && onUploadComplete) {
      onUploadComplete(uploadedDocuments);
    }

    // Auto-close after all uploads complete (successful or not)
    if (uploadedDocuments.length === filestoUpload.length) {
      setTimeout(() => {
        handleClose();
      }, 1500);
    }
  };

  const handleClose = () => {
    if (isUploading) {
      const confirm = window.confirm(
        'Upload in progress. Are you sure you want to close?'
      );
      if (!confirm) return;
    }
    setSelectedFiles([]);
    setUploadingFiles([]);
    setIsUploading(false);
    onClose();
  };

  const hasFiles = selectedFiles.length > 0 || uploadingFiles.length > 0;
  const canUpload = selectedFiles.length > 0 && !isUploading;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
          <DialogDescription>
            {projectId
              ? "Upload supporting documents for this project. Maximum 10MB per file."
              : "Upload documents. You can assign them to projects later. Maximum 10MB per file."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!isUploading && (
            <DropZone
              onFilesSelected={handleFilesSelected}
              multiple={true}
              disabled={isUploading}
            />
          )}

          {selectedFiles.length > 0 && (
            <FileList
              files={selectedFiles}
              onRemove={handleRemoveFile}
              disabled={isUploading}
            />
          )}

          {uploadingFiles.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-foreground">
                Upload Progress
              </h3>
              {uploadingFiles.map((file) => (
                <UploadProgress
                  key={file.id}
                  fileName={file.file.name}
                  fileSize={file.file.size}
                  progress={file.progress}
                  status={file.status}
                  error={file.error}
                />
              ))}
            </div>
          )}

          {!hasFiles && !isUploading && (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No files selected</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isUploading}
          >
            {isUploading ? 'Close' : 'Cancel'}
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!canUpload}
          >
            Upload {selectedFiles.length > 0 && `(${selectedFiles.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UploadDocumentsModal;
