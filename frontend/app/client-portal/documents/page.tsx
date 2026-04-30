"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, FolderOpen, FileText, Search, Calendar } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { iconWellClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import Link from "next/link";

interface Document {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: string;
  description: string | null;
  uploadedAt: string;
  uploadedBy: {
    firstName: string;
    lastName: string;
  };
  project: {
    id: string;
    projectNumber: string;
    title: string;
  };
}

const documentStatusColors: Record<string, string> = {
  PENDING:    "bg-amber-500/15   text-amber-700   dark:text-amber-300",
  UPLOADED:   "bg-blue-500/15    text-blue-700    dark:text-blue-300",
  PROCESSING: "bg-violet-500/15  text-violet-700  dark:text-violet-300",
  VERIFIED:   "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  REJECTED:   "bg-rose-500/15    text-rose-700    dark:text-rose-300",
};

export default function ClientDocumentsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const response = await api.get("/client-portal/documents");
      setDocuments(response.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to load documents",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) {
      return "🖼️";
    } else if (mimeType.includes("pdf")) {
      return "📄";
    } else if (mimeType.includes("word") || mimeType.includes("document")) {
      return "📝";
    } else if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) {
      return "📊";
    } else {
      return "📎";
    }
  };

  const filteredDocuments = documents.filter((doc) => {
    const search = searchTerm.toLowerCase();
    return (
      doc.fileName.toLowerCase().includes(search) ||
      (doc.description?.toLowerCase() || "").includes(search) ||
      doc.project.projectNumber.toLowerCase().includes(search) ||
      doc.project.title.toLowerCase().includes(search)
    );
  });

  // Group documents by project
  const documentsByProject = filteredDocuments.reduce((acc, doc) => {
    const projectId = doc.project.id;
    if (!acc[projectId]) {
      acc[projectId] = {
        project: doc.project,
        documents: [],
      };
    }
    acc[projectId].documents.push(doc);
    return acc;
  }, {} as Record<string, { project: Document["project"]; documents: Document[] }>);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Documents</h1>
        <p className="text-muted-foreground mt-1">
          View and download your tax documents
        </p>
      </div>

      {/* Summary Card */}
      <Card className="p-6 bg-card border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconWellClass("primary")}`}>
              <FolderOpen className="w-6 h-6" />
            </div>
            <div>
              <p className="text-3xl font-bold text-foreground">
                {documents.length}
              </p>
              <p className="text-sm text-muted-foreground">Total Documents</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Across</p>
            <p className="text-lg font-semibold text-foreground">
              {Object.keys(documentsByProject).length} Projects
            </p>
          </div>
        </div>
      </Card>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search documents by name, description, or project..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Documents Grouped by Project */}
      {Object.keys(documentsByProject).length === 0 ? (
        <Card className="p-12 text-center bg-card border-border">
          <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            {searchTerm ? "No documents found matching your search" : "No documents yet"}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(documentsByProject).map(([projectId, { project: projectData, documents: projectDocs }]) => (
            <Card key={projectId} className="bg-card border-border">
              {/* Project Header */}
              <Link href={`/client-portal/projects/${projectId}`}>
                <div className="p-4 border-b border-border hover:bg-muted/30 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-primary" />
                      <div>
                        <p className="font-semibold text-foreground">
                          {projectData.title}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Project #{projectData.projectNumber}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300">
                      {projectDocs.length} {projectDocs.length === 1 ? "document" : "documents"}
                    </Badge>
                  </div>
                </div>
              </Link>

              {/* Documents List */}
              <div className="divide-y divide-border">
                {projectDocs.map((doc) => (
                  <div key={doc.id} className="p-4 hover:bg-muted/30">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3 flex-1">
                        <span className="text-2xl">{getFileIcon(doc.mimeType)}</span>
                        <div className="flex-1">
                          <p className="font-medium text-foreground">
                            {doc.fileName}
                          </p>
                          {doc.description && (
                            <p className="text-sm text-muted-foreground mt-1">
                              {doc.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                            <span>{formatFileSize(doc.fileSize)}</span>
                            <span>•</span>
                            <div className="flex items-center gap-1">
                              <Calendar className="w-4 h-4" />
                              {format(new Date(doc.uploadedAt), "MMM d, yyyy h:mm a")}
                            </div>
                            <span>•</span>
                            <span>
                              Uploaded by {doc.uploadedBy.firstName}{" "}
                              {doc.uploadedBy.lastName}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Badge className={documentStatusColors[doc.status]}>
                        {doc.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
