"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  FolderOpen,
  FileText,
  Search,
  Calendar,
  Image as ImageIcon,
  FileSpreadsheet,
  FileType,
  Paperclip,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import api from "@/lib/api";
import { format } from "date-fns";
import Link from "next/link";
import { PortalPageHeader, StatCard, PortalEmpty, formatFileSize } from "@/components/portal";

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

/** A tinted icon for the file type — replaces the old emoji glyphs so the row
 *  reads consistently in light + dark and matches the app's icon language. */
function FileGlyph({ mimeType }: { mimeType: string }) {
  let Icon = Paperclip;
  let tone = "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
  if (mimeType.startsWith("image/")) {
    Icon = ImageIcon;
    tone = "bg-violet-500/15 text-violet-600 dark:text-violet-300";
  } else if (mimeType.includes("pdf")) {
    Icon = FileType;
    tone = "bg-rose-500/15 text-rose-600 dark:text-rose-300";
  } else if (mimeType.includes("word") || mimeType.includes("document")) {
    Icon = FileText;
    tone = "bg-blue-500/15 text-blue-600 dark:text-blue-300";
  } else if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) {
    Icon = FileSpreadsheet;
    tone = "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300";
  }
  return (
    <span
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone}`}
    >
      <Icon className="h-5 w-5" strokeWidth={1.9} />
    </span>
  );
}

export default function ClientDocumentsPage() {
  const { toast } = useToast();
  const hydrated = useHydrated();
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
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PortalPageHeader
        icon={FolderOpen}
        title="Documents"
        subtitle="Every file we've shared with you, neatly grouped by project. Open a project to view or download anything in context."
      />

      {/* Summary */}
      {documents.length > 0 && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <StatCard
            icon={FolderOpen}
            tone="primary"
            label="Shared documents"
            value={documents.length}
            hint="Files we've shared with you"
          />
          <StatCard
            icon={FileText}
            tone="violet"
            label="Across projects"
            value={Object.keys(documentsByProject).length}
            hint="Grouped for easy browsing"
          />
        </div>
      )}

      {/* Search */}
      {documents.length > 0 && (
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by file name, description, or project…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-11 pl-11"
            aria-label="Search documents"
          />
        </div>
      )}

      {/* Documents grouped by project */}
      {Object.keys(documentsByProject).length === 0 ? (
        searchTerm ? (
          <PortalEmpty
            icon={Search}
            iconTone="zinc"
            title="No matching documents"
            body={`Nothing matched "${searchTerm}". Try a different file name or project.`}
          />
        ) : (
          <PortalEmpty
            icon={FolderOpen}
            title="No documents yet"
            body="When we share files with you — proposals, deliverables, reports — they'll appear here, organised by project."
          />
        )
      ) : (
        <div className="space-y-6">
          {Object.entries(documentsByProject).map(
            ([projectId, { project: projectData, documents: projectDocs }]) => (
              <Card key={projectId} className="overflow-hidden bg-card">
                {/* Project header */}
                <Link href={`/client-portal/projects/${projectId}`}>
                  <div className="group flex items-center justify-between border-b border-border px-5 py-4 transition-colors hover:bg-muted/40">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                        <FileText className="h-5 w-5" strokeWidth={1.9} />
                      </span>
                      <div>
                        <p className="font-semibold text-foreground transition-colors group-hover:text-primary">
                          {projectData.title}
                        </p>
                        <p className="font-mono text-xs text-muted-foreground">
                          #{projectData.projectNumber}
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-300">
                      {projectDocs.length}{" "}
                      {projectDocs.length === 1 ? "document" : "documents"}
                    </Badge>
                  </div>
                </Link>

                {/* Documents list */}
                <div className="divide-y divide-border">
                  {projectDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-muted/30"
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-3.5">
                        <FileGlyph mimeType={doc.mimeType} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-foreground">
                            {doc.fileName}
                          </p>
                          {doc.description && (
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {doc.description}
                            </p>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{formatFileSize(doc.fileSize)}</span>
                            <span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {hydrated
                                ? format(new Date(doc.uploadedAt), "MMM d, yyyy")
                                : "—"}
                            </span>
                            <span aria-hidden>·</span>
                            <span>
                              {doc.uploadedBy.firstName} {doc.uploadedBy.lastName}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Badge
                        className={
                          documentStatusColors[doc.status] ??
                          "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300"
                        }
                      >
                        {doc.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            ),
          )}
        </div>
      )}
    </div>
  );
}
