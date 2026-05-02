"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import {
  Upload,
  Search,
  FileText,
  Download,
  Trash2,
  File,
  Image,
  FileSpreadsheet,
  Eye,
  FolderOpen,
  Plus,
  HardDrive,
  Files,
} from "lucide-react";
import UploadDocumentsModal from "@/components/modals/upload-documents-modal";
import { EmptyState } from "@/components/ui/empty-state";
import { DocumentViewerModal } from "@/components/documents/document-viewer-modal";
import { iconWellClass } from "@/lib/badge-styles";
import { projectColorClasses } from "@/lib/project-colors";

interface Document {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  projectId: string;
  uploadedById: string;
  createdAt: string;
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewingDocument, setViewingDocument] = useState<Document | null>(null);
  const [viewingDocumentUrl, setViewingDocumentUrl] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      const response = await api.get("/documents?page=1&limit=100");
      setDocuments(response.data.data || []);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching documents:", error);
      toast({
        title: "Error",
        description: "Failed to load documents",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const handleUploadClick = () => {
    setUploadModalOpen(true);
  };

  const handleDownload = async (doc: Document) => {
    try {
      // Use direct download endpoint instead of presigned URL
      const response = await api.get(`/documents/${doc.id}/download`, {
        responseType: 'blob',
      });

      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const link = window.document.createElement('a');
      link.href = url;
      link.download = doc.fileName;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Success",
        description: "Download started",
      });
    } catch (error) {
      console.error('Failed to download document:', error);
      toast({
        title: "Error",
        description: "Failed to download document",
        variant: "destructive",
      });
    }
  };

  const handleView = async (doc: Document) => {
    try {
      // Fetch the document as a blob with authentication
      const response = await api.get(`/documents/${doc.id}/view`, {
        responseType: 'blob',
      });

      // Create a blob URL for the viewer modal
      const blob = response.data;
      const url = window.URL.createObjectURL(blob);

      setViewingDocument(doc);
      setViewingDocumentUrl(url);
      setViewerOpen(true);
    } catch (error) {
      console.error('Failed to view document:', error);
      toast({
        title: "Error",
        description: "Failed to view document",
        variant: "destructive",
      });
    }
  };

  const handleCloseViewer = () => {
    setViewerOpen(false);
    // Clean up blob URL after modal closes
    if (viewingDocumentUrl) {
      setTimeout(() => {
        window.URL.revokeObjectURL(viewingDocumentUrl);
        setViewingDocumentUrl(null);
        setViewingDocument(null);
      }, 100);
    }
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Are you sure you want to delete "${doc.fileName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await api.delete(`/documents/${doc.id}`);
      toast({
        title: "Success",
        description: "Document deleted successfully",
      });
      fetchDocuments(); // Refresh the list
    } catch (error) {
      console.error('Failed to delete document:', error);
      toast({
        title: "Error",
        description: "Failed to delete document",
        variant: "destructive",
      });
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) {
      return <Image className="h-5 w-5 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} />;
    } else if (
      mimeType.includes("spreadsheet") ||
      mimeType.includes("excel")
    ) {
      return <FileSpreadsheet className="h-5 w-5 text-emerald-600 dark:text-emerald-400" strokeWidth={1.75} />;
    } else if (mimeType.includes("pdf")) {
      return <FileText className="h-5 w-5 text-rose-600 dark:text-rose-400" strokeWidth={1.75} />;
    }
    return <File className="h-5 w-5 text-zinc-600 dark:text-zinc-400" strokeWidth={1.75} />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const filteredDocuments = documents.filter((doc) =>
    doc.fileName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-muted rounded w-1/3"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Documents</h1>
          <p className="text-muted-foreground mt-1">
            Manage and organize project documents
          </p>
        </div>
        <Button className="bg-primary hover:bg-primary/90" onClick={handleUploadClick}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Document
        </Button>
      </div>

      {/* Stats — match dashboard tinted-icon-well pattern (v1.6.31) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("blue")}`}>
              <Files className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total Documents
              </div>
              <div className="text-2xl font-bold leading-tight">{documents.length}</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("violet")}`}>
              <HardDrive className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total Size
              </div>
              <div className="text-2xl font-bold leading-tight">
                {formatFileSize(
                  documents.reduce((acc, doc) => acc + doc.fileSize, 0)
                )}
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("rose")}`}>
              <FileText className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                PDFs
              </div>
              <div className="text-2xl font-bold leading-tight">
                {documents.filter((d) => d.mimeType.includes("pdf")).length}
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass("emerald")}`}>
              <Image className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Images
              </div>
              <div className="text-2xl font-bold leading-tight">
                {documents.filter((d) => d.mimeType.startsWith("image/")).length}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Documents List */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  File Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Size
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Uploaded
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredDocuments.map((doc) => {
                const pc = doc.projectId ? projectColorClasses(doc.projectId) : null;
                return (
                  <tr
                    key={doc.id}
                    className={`group hover:bg-muted/30 transition-colors ${pc ? pc.cardWash : ""}`}
                  >
                    <td className={`px-6 py-4 whitespace-nowrap ${pc ? `border-l-4 ${pc.borderLeft}` : ""}`}>
                      <div className="flex items-center gap-3">
                        {getFileIcon(doc.mimeType)}
                        <span className="text-sm font-medium text-foreground">
                          {doc.fileName}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {doc.mimeType.split("/")[1].toUpperCase()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {formatFileSize(doc.fileSize)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {new Date(doc.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleView(doc)}
                          title="View document"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(doc)}
                          title="Download document"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(doc)}
                          title="Delete document"
                        >
                          <Trash2 className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredDocuments.length === 0 && (
          <div className="p-4">
            <EmptyState
              icon={FolderOpen}
              iconTone="orange"
              title={searchTerm ? "No documents match" : "No documents yet"}
              body={
                searchTerm
                  ? "Try a different search, or clear the filter."
                  : "Upload a file to attach it to a project. S3-compatible storage with your team and clients."
              }
              action={
                !searchTerm && (
                  <Button onClick={() => setUploadModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Upload document
                  </Button>
                )
              }
              className="border-0"
            />
          </div>
        )}
      </Card>

      {/* Upload Modal - Opens directly without project selection */}
      <UploadDocumentsModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        projectId=""
        onUploadComplete={() => {
          setUploadModalOpen(false);
          fetchDocuments();
        }}
      />

      {/* Document Viewer Modal */}
      <DocumentViewerModal
        document={viewingDocument}
        fileUrl={viewingDocumentUrl}
        isOpen={viewerOpen}
        onClose={handleCloseViewer}
      />
    </div>
  );
}
