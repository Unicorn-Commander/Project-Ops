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

const statusColors: Record<string, string> = {
  NEW: "bg-blue-100 text-blue-800",
  IN_PROGRESS: "bg-yellow-100 text-yellow-800",
  UNDER_REVIEW: "bg-purple-100 text-purple-800",
  COMPLETED: "bg-green-100 text-green-800",
  ARCHIVED: "bg-gray-100 text-gray-800",
};

const priorityColors: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-800",
  MEDIUM: "bg-blue-100 text-blue-800",
  HIGH: "bg-orange-100 text-orange-800",
  URGENT: "bg-red-100 text-red-800",
};

const paymentStatusColors: Record<string, string> = {
  UNPAID: "bg-red-100 text-red-800",
  PARTIALLY_PAID: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  OVERDUE: "bg-red-100 text-red-800",
  CANCELLED: "bg-gray-100 text-gray-800",
};

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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-[#005AF5]" />
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
        <Button variant="ghost" className="text-[#005AF5] hover:text-[#004CCE]">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Projects
        </Button>
      </Link>

      {/* Project Header */}
      <Card className="p-6 bg-white border-[#D4DADE]">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-mono text-[#A5A6AA]">
              #{projectData.projectNumber}
            </span>
            <Badge className={statusColors[projectData.status]}>
              {projectData.status.replace("_", " ")}
            </Badge>
            <Badge className={priorityColors[projectData.priority]}>
              {projectData.priority}
            </Badge>
          </div>
          <span className="text-sm text-[#A5A6AA]">
            Created {formatDate(projectData.createdAt)}
          </span>
        </div>

        <h1 className="text-2xl font-bold text-[#10172B] mb-2">
          {projectData.title}
        </h1>

        {projectData.description && (
          <p className="text-[#A5A6AA] mb-4">{projectData.description}</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-[#D4DADE]">
          {projectData.assignedTo && (
            <div className="flex items-center gap-2">
              <User className="w-5 h-5 text-[#A5A6AA]" />
              <div>
                <p className="text-xs text-[#A5A6AA]">Assigned To</p>
                <p className="text-sm font-medium text-[#10172B]">
                  {projectData.assignedTo.firstName} {projectData.assignedTo.lastName}
                </p>
              </div>
            </div>
          )}
          {projectData.dueDate && (
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#A5A6AA]" />
              <div>
                <p className="text-xs text-[#A5A6AA]">Due Date</p>
                <p className="text-sm font-medium text-[#10172B]">
                  {formatDate(projectData.dueDate)}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Billing Information */}
      {projectData.billingAmount && (
        <Card className="p-6 bg-white border-[#D4DADE]">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-[#005AF5]" />
            <h2 className="text-lg font-bold text-[#10172B]">Billing Information</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projectData.invoiceNumber && (
              <div>
                <p className="text-xs text-[#A5A6AA] mb-1">Invoice Number</p>
                <p className="text-sm font-medium text-[#10172B]">
                  {projectData.invoiceNumber}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-[#A5A6AA] mb-1">Total Amount</p>
              <p className="text-sm font-medium text-[#10172B]">
                ${projectData.billingAmount.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#A5A6AA] mb-1">Amount Paid</p>
              <p className="text-sm font-medium text-[#10172B]">
                ${(projectData.amountPaid || 0).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#A5A6AA] mb-1">Outstanding Balance</p>
              <p className="text-sm font-medium text-[#10172B]">
                ${(projectData.billingAmount - (projectData.amountPaid || 0)).toFixed(2)}
              </p>
            </div>
            {projectData.paymentStatus && (
              <div>
                <p className="text-xs text-[#A5A6AA] mb-1">Payment Status</p>
                <Badge className={paymentStatusColors[projectData.paymentStatus]}>
                  {projectData.paymentStatus.replace("_", " ")}
                </Badge>
              </div>
            )}
            {projectData.paymentDueDate && (
              <div>
                <p className="text-xs text-[#A5A6AA] mb-1">Payment Due</p>
                <p className="text-sm font-medium text-[#10172B]">
                  {formatDate(projectData.paymentDueDate)}
                </p>
              </div>
            )}
          </div>

          {projectData.billingNotes && (
            <div className="mt-4 pt-4 border-t border-[#D4DADE]">
              <p className="text-xs text-[#A5A6AA] mb-1">Notes</p>
              <p className="text-sm text-[#10172B]">{projectData.billingNotes}</p>
            </div>
          )}
        </Card>
      )}

      {/* Documents */}
      <Card className="bg-white border-[#D4DADE]">
        <div className="p-6 border-b border-[#D4DADE]">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-[#005AF5]" />
            <h2 className="text-lg font-bold text-[#10172B]">
              Documents ({projectData.documents.length})
            </h2>
          </div>
        </div>

        {projectData.documents.length === 0 ? (
          <div className="p-12 text-center">
            <FolderOpen className="w-12 h-12 text-[#D4DADE] mx-auto mb-4" />
            <p className="text-[#A5A6AA]">No documents uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[#D4DADE]">
            {projectData.documents.map((doc) => (
              <div key={doc.id} className="p-4 hover:bg-[#F5F9FC]">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-[#10172B]">{doc.fileName}</p>
                    <p className="text-sm text-[#A5A6AA]">
                      {formatFileSize(doc.fileSize)} • Uploaded by{" "}
                      {doc.uploadedBy.firstName} {doc.uploadedBy.lastName} •{" "}
                      {formatDate(doc.uploadedAt)}
                    </p>
                  </div>
                  <Badge className="bg-blue-100 text-blue-800">
                    {doc.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Comments */}
      <Card className="bg-white border-[#D4DADE]">
        <div className="p-6 border-b border-[#D4DADE]">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#005AF5]" />
            <h2 className="text-lg font-bold text-[#10172B]">
              Comments ({projectData.comments.length})
            </h2>
          </div>
        </div>

        {projectData.comments.length === 0 ? (
          <div className="p-12 text-center">
            <MessageSquare className="w-12 h-12 text-[#D4DADE] mx-auto mb-4" />
            <p className="text-[#A5A6AA]">No comments yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[#D4DADE]">
            {projectData.comments.map((comment) => (
              <div key={comment.id} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-medium text-[#10172B]">
                    {comment.author.firstName} {comment.author.lastName}
                  </span>
                  <span className="text-sm text-[#A5A6AA]">
                    {formatDate(comment.createdAt)}
                  </span>
                </div>
                <p className="text-[#10172B]">{comment.content}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
