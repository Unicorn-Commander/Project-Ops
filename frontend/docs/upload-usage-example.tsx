/**
 * USAGE EXAMPLE: Project Ops Document Upload System
 *
 * This file demonstrates how to integrate the document upload modal
 * into your project management pages.
 */

"use client"

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import UploadDocumentsModal from '@/components/modals/upload-documents-modal';
import { Upload } from 'lucide-react';
import { DocumentResponse } from '@/lib/upload-service';
import { useToast } from '@/components/ui/use-toast';

// Example: Project Detail Page Component
export default function ProjectDetailPageExample() {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentResponse[]>([]);
  const { toast } = useToast();

  // This would come from your project context or route params
  const projectId = 'project-123';

  const handleUploadComplete = (uploadedDocs: DocumentResponse[]) => {
    // Add newly uploaded documents to the list
    setDocuments((prev) => [...prev, ...uploadedDocs]);

    toast({
      title: 'Documents uploaded',
      description: `Successfully uploaded ${uploadedDocs.length} document(s)`,
    });

    // Close modal after successful upload
    setIsUploadModalOpen(false);

    // Optional: Refresh project data from API
    // refetchCaseDocuments();
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">Case Documents</h1>

        {/* Upload Button */}
        <Button onClick={() => setIsUploadModalOpen(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Upload Documents
        </Button>
      </div>

      {/* Document List */}
      <div className="space-y-4">
        {documents.length === 0 ? (
          <p className="text-muted-foreground">No documents uploaded yet.</p>
        ) : (
          documents.map((doc) => (
            <div key={doc.id} className="border rounded-lg p-4">
              <p className="font-medium">{doc.fileName}</p>
              <p className="text-sm text-muted-foreground">
                {(doc.fileSize / 1024).toFixed(2)} KB
              </p>
            </div>
          ))
        )}
      </div>

      {/* Upload Modal */}
      <UploadDocumentsModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        projectId={projectId}
        onUploadComplete={handleUploadComplete}
      />
    </div>
  );
}

/**
 * ALTERNATIVE USAGE: Inline Upload Component
 *
 * If you want to embed the upload functionality directly without a modal:
 */

import DropZone from '@/components/file-upload/drop-zone';
import FileList, { FileItem } from '@/components/file-upload/file-list';
import UploadProgress from '@/components/file-upload/upload-progress';
import { uploadFile } from '@/lib/upload-service';

export function InlineUploadExample({ projectId }: { projectId: string }) {
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const { toast } = useToast();

  const handleFilesSelected = (files: File[]) => {
    const newFiles: FileItem[] = files.map((file) => ({
      file,
      id: `${file.name}-${Date.now()}-${Math.random()}`,
    }));
    setSelectedFiles((prev) => [...prev, ...newFiles]);
  };

  const handleRemoveFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleUpload = async () => {
    for (const fileItem of selectedFiles) {
      try {
        await uploadFile(fileItem.file, projectId, (progress) => {
          setUploadProgress((prev) => ({
            ...prev,
            [fileItem.id]: progress,
          }));
        });

        toast({
          title: 'Upload successful',
          description: `${fileItem.file.name} uploaded successfully`,
        });
      } catch (error) {
        toast({
          title: 'Upload failed',
          description: `Failed to upload ${fileItem.file.name}`,
          variant: 'destructive',
        });
      }
    }

    // Clear after upload
    setSelectedFiles([]);
    setUploadProgress({});
  };

  return (
    <div className="space-y-6">
      <DropZone onFilesSelected={handleFilesSelected} />

      {selectedFiles.length > 0 && (
        <>
          <FileList files={selectedFiles} onRemove={handleRemoveFile} />
          <Button onClick={handleUpload} className="w-full">
            Upload {selectedFiles.length} file(s)
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * INTEGRATION CHECKLIST:
 *
 * 1. ✅ Import UploadDocumentsModal component
 * 2. ✅ Add state for modal visibility
 * 3. ✅ Add projectId (from route params or context)
 * 4. ✅ Add upload button with onClick handler
 * 5. ✅ Render modal with props
 * 6. ✅ Handle onUploadComplete callback
 * 7. ✅ Optional: Refresh document list from API
 *
 * BACKEND API ENDPOINTS REQUIRED:
 * - POST /api/v1/documents/generate-upload-url
 * - POST /api/v1/documents/confirm-upload
 * - GET /api/v1/documents/:id/download-url
 * - GET /api/v1/documents/project/:projectId (to list documents)
 */
