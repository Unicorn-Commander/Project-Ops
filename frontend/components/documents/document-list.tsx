'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  FileText,
  Image as ImageIcon,
  File,
  FolderOpen,
  Eye,
  Download,
  Trash2,
  Loader2,
  Upload,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { api } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { DocumentViewerModal } from './document-viewer-modal';
import UploadDocumentsModal from '../modals/upload-documents-modal';

interface Document {
  id: string;
  projectId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
  uploadedById: string;
  uploadedAt: string;
}

interface DocumentListProps {
  projectId: string;
}

export function DocumentList({ projectId }: DocumentListProps) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDocument, setSelectedDocument] = useState<Document | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null);
  const [userRole, setUserRole] = useState('');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  useEffect(() => {
    const role = localStorage.getItem('userRole') || '';
    setUserRole(role);
    fetchDocuments();
  }, [projectId]);

  const fetchDocuments = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/documents/project/${projectId}`);
      setDocuments(response.data);
    } catch (error) {
      console.error('Failed to fetch documents:', error);
      toast({ title: 'Failed to load documents', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType === 'application/pdf') return <FileText className="h-5 w-5 text-red-600" />;
    if (mimeType.startsWith('image/')) return <ImageIcon className="h-5 w-5 text-blue-600" />;
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const handlePreview = async (document: Document) => {
    try {
      const response = await api.get(`/documents/${document.id}/download-url`);
      setSelectedDocument(document);
      setPreviewUrl(response.data.url);
      setShowViewer(true);
    } catch (error) {
      console.error('Failed to get preview URL:', error);
      toast({ title: 'Failed to preview document', variant: 'destructive' });
    }
  };

  const handleDownload = async (document: Document) => {
    try {
      const response = await api.get(`/documents/${document.id}/download-url`);
      const link = window.document.createElement('a');
      link.href = response.data.url;
      link.download = document.fileName;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      toast({ title: 'Download started', variant: 'success' });
    } catch (error) {
      console.error('Failed to download document:', error);
      toast({ title: 'Failed to download document', variant: 'destructive' });
    }
  };

  const handleDelete = async () => {
    if (!documentToDelete) return;

    try {
      await api.delete(`/documents/${documentToDelete}`);
      toast({ title: 'Document deleted', variant: 'success' });
      fetchDocuments();
    } catch (error) {
      console.error('Failed to delete document:', error);
      toast({ title: 'Failed to delete document', variant: 'destructive' });
    } finally {
      setDeleteDialogOpen(false);
      setDocumentToDelete(null);
    }
  };

  const canDelete = () => {
    return ['ADMIN', 'MANAGER'].includes(userRole);
  };

  const canUpload = () => {
    return ['ADMIN', 'MANAGER', 'STAFF'].includes(userRole);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      {/* Upload Button */}
      {canUpload() && (
        <div className="mb-4">
          <Button onClick={() => setUploadModalOpen(true)} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            Upload Documents
          </Button>
        </div>
      )}

      {documents.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          iconTone="orange"
          title="No documents yet"
          body={
            canUpload()
              ? "Upload your first file to attach it to this project."
              : "No files have been attached to this project yet."
          }
          action={
            canUpload() ? (
              <Button onClick={() => setUploadModalOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                Upload your first file
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-2">
        {documents.map((document) => (
          <Card key={document.id} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                {getFileIcon(document.mimeType)}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground truncate">
                    {document.fileName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(document.fileSize)} • {formatDate(document.uploadedAt)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePreview(document)}
                  aria-label={`Preview ${document.fileName}`}
                >
                  <Eye className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDownload(document)}
                  aria-label={`Download ${document.fileName}`}
                >
                  <Download className="h-4 w-4" />
                </Button>
                {canDelete() && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDocumentToDelete(document.id);
                      setDeleteDialogOpen(true);
                    }}
                    aria-label={`Delete ${document.fileName}`}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
        </div>
      )}

      <UploadDocumentsModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        projectId={projectId}
        onUploadComplete={() => {
          setUploadModalOpen(false);
          fetchDocuments();
        }}
      />

      <DocumentViewerModal
        document={selectedDocument}
        fileUrl={previewUrl}
        isOpen={showViewer}
        onClose={() => {
          setShowViewer(false);
          setSelectedDocument(null);
          setPreviewUrl(null);
        }}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this document? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
