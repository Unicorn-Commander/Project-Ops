"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  ArrowLeft,
  FileText,
  FolderOpen,
  Calendar,
  User,
  MessageSquare,
  DollarSign,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import {
  statusBadgeClass,
  priorityBadgeClass,
  paymentStatusBadgeClass,
} from "@/lib/badge-styles";
import { format } from "date-fns";
import Link from "next/link";

interface ProjectDetails {
  id: string;
  projectNumber: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueDate: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  invoiceNumber: string | null;
  billingAmount: number | null;
  amountPaid: number | null;
  paymentStatus: string | null;
  billingDate: string | null;
  paymentDueDate: string | null;
  paymentReceivedDate: string | null;
  billingNotes: string | null;
  assignedTo: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  documents: Array<{
    id: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    status: string;
    uploadedAt: string;
    uploadedBy: {
      firstName: string;
      lastName: string;
    };
  }>;
  comments: Array<{
    id: string;
    content: string;
    createdAt: string;
    author: {
      firstName: string;
      lastName: string;
    };
  }>;
}

export default function ProjectDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [projectData, setProjectData] = useState<ProjectDetails | null>(null);

  const projectId = params?.id as string;

  useEffect(() => {
    if (projectId) {
      loadProject();
    }
  }, [projectId]);

  const loadProject = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/client-portal/projects/${projectId}`);
      setProjectData(response.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to load project details",
        variant: "destructive",
      });
      router.push("/client-portal/projects");
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!projectData) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/client-portal/projects">
        <Button variant="ghost" className="text-primary hover:text-primary/90">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>
      </Link>

      {/* Project Header */}
      <Card className="p-6 bg-card border-border">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-mono text-muted-foreground">
              #{projectData.projectNumber}
            </span>
            <Badge className={statusBadgeClass(projectData.status)}>
              {projectData.status.replace("_", " ")}
            </Badge>
            <Badge className={priorityBadgeClass(projectData.priority)}>
              {projectData.priority}
            </Badge>
          </div>
          <span className="text-sm text-muted-foreground">
            Created {format(new Date(projectData.createdAt), "MMM d, yyyy")}
          </span>
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-2">
          {projectData.title}
        </h1>

        {projectData.description && (
          <p className="text-muted-foreground mb-4">{projectData.description}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
          {projectData.assignedTo && (
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Assigned To</p>
                <p className="text-sm font-medium text-foreground">
                  {projectData.assignedTo.firstName} {projectData.assignedTo.lastName}
                </p>
              </div>
            </div>
          )}
          {projectData.dueDate && (
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Due Date</p>
                <p className="text-sm font-medium text-foreground">
                  {format(new Date(projectData.dueDate), "MMM d, yyyy")}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Billing Information */}
      {projectData.billingAmount && (
        <Card className="p-6 bg-card border-border">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Billing Information</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projectData.invoiceNumber && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Invoice Number</p>
                <p className="text-sm font-medium text-foreground">
                  {projectData.invoiceNumber}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">Total Amount</p>
              <p className="text-sm font-medium text-foreground">
                ${projectData.billingAmount.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Amount Paid</p>
              <p className="text-sm font-medium text-foreground">
                ${(projectData.amountPaid || 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Outstanding Balance</p>
              <p className="text-sm font-medium text-foreground">
                ${(projectData.billingAmount - (projectData.amountPaid || 0)).toFixed(2)}
              </p>
            </div>
            {projectData.paymentStatus && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Payment Status</p>
                <Badge className={paymentStatusBadgeClass(projectData.paymentStatus)}>
                  {projectData.paymentStatus.replace("_", " ")}
                </Badge>
              </div>
            )}
            {projectData.paymentDueDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Payment Due</p>
                <p className="text-sm font-medium text-foreground">
                  {format(new Date(projectData.paymentDueDate), "MMM d, yyyy")}
                </p>
              </div>
            )}
          </div>

          {projectData.billingNotes && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm text-foreground">{projectData.billingNotes}</p>
            </div>
          )}
        </Card>
      )}

      {/* Documents */}
      <Card className="bg-card border-border">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">
              Documents ({projectData.documents.length})
            </h2>
          </div>
        </div>

        {projectData.documents.length === 0 ? (
          <div className="p-12 text-center">
            <FolderOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {projectData.documents.map((doc) => (
              <div key={doc.id} className="p-4 hover:bg-muted/30">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-foreground">{doc.fileName}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(doc.fileSize)} • Uploaded by{" "}
                      {doc.uploadedBy.firstName} {doc.uploadedBy.lastName} •{" "}
                      {format(new Date(doc.uploadedAt), "MMM d, yyyy")}
                    </p>
                  </div>
                  <Badge className={statusBadgeClass(doc.status)}>
                    {doc.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Comments */}
      <Card className="bg-card border-border">
        <div className="p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">
              Comments ({projectData.comments.length})
            </h2>
          </div>
        </div>

        {projectData.comments.length === 0 ? (
          <div className="p-12 text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No comments yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {projectData.comments.map((comment) => (
              <div key={comment.id} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-foreground">
                    {comment.author.firstName} {comment.author.lastName}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(comment.createdAt), "MMM d, yyyy")}
                  </span>
                </div>
                <p className="text-foreground">{comment.content}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
