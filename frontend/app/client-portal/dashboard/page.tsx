"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, FolderOpen, Calendar, User } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import Link from "next/link";

interface DashboardData {
  totalProjects: number;
  totalDocuments: number;
  recentProjects: Array<{
    id: string;
    projectNumber: string;
    title: string;
    status: string;
    priority: string;
    dueDate: string | null;
    createdAt: string;
    assignedTo: {
      firstName: string;
      lastName: string;
    } | null;
    _count: {
      documents: number;
      comments: number;
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

export default function ClientPortalDashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const response = await api.get("/client-portal/dashboard");
      setData(response.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to load dashboard",
        variant: "destructive",
      });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-[#005AF5]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-[#A5A6AA]">Unable to load dashboard data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-3xl font-bold text-[#10172B]">Welcome to Your Portal</h1>
        <p className="text-[#A5A6AA] mt-1">
          View and manage your projects and documents
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Total Projects Card */}
        <Card className="p-6 bg-white border-[#D4DADE]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#A5A6AA]">Total Projects</p>
              <p className="text-3xl font-bold text-[#10172B] mt-2">
                {data.totalProjects}
              </p>
            </div>
            <div className="w-12 h-12 bg-[#005AF5] bg-opacity-10 rounded-lg flex items-center justify-center">
              <FileText className="w-6 h-6 text-[#005AF5]" />
            </div>
          </div>
          <Link href="/client-portal/projects">
            <Button
              variant="link"
              className="text-[#005AF5] hover:text-[#004CCE] p-0 mt-4"
            >
              View all projects →
            </Button>
          </Link>
        </Card>

        {/* Total Documents Card */}
        <Card className="p-6 bg-white border-[#D4DADE]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[#A5A6AA]">Total Documents</p>
              <p className="text-3xl font-bold text-[#10172B] mt-2">
                {data.totalDocuments}
              </p>
            </div>
            <div className="w-12 h-12 bg-[#c5a48e] bg-opacity-10 rounded-lg flex items-center justify-center">
              <FolderOpen className="w-6 h-6 text-[#c5a48e]" />
            </div>
          </div>
          <Link href="/client-portal/documents">
            <Button
              variant="link"
              className="text-[#005AF5] hover:text-[#004CCE] p-0 mt-4"
            >
              View all documents →
            </Button>
          </Link>
        </Card>
      </div>

      {/* Recent Projects */}
      <Card className="bg-white border-[#D4DADE]">
        <div className="p-6 border-b border-[#D4DADE]">
          <h2 className="text-xl font-bold text-[#10172B]">Recent Projects</h2>
        </div>

        {data.recentProjects.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-[#D4DADE] mx-auto mb-4" />
            <p className="text-[#A5A6AA]">No projects yet</p>
          </div>
        ) : (
          <div className="divide-y divide-[#D4DADE]">
            {data.recentProjects.map((project_) => (
              <Link
                key={project_.id}
                href={`/client-portal/projects/${project_.id}`}
                className="block p-6 hover:bg-[#F5F9FC] transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-mono text-[#A5A6AA]">
                        #{project_.projectNumber}
                      </span>
                      <Badge className={statusColors[project_.status]}>
                        {project_.status.replace("_", " ")}
                      </Badge>
                      <Badge className={priorityColors[project_.priority]}>
                        {project_.priority}
                      </Badge>
                    </div>
                    <h3 className="text-lg font-semibold text-[#10172B] mb-2">
                      {project_.title}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-[#A5A6AA]">
                      {project_.assignedTo && (
                        <div className="flex items-center gap-1">
                          <User className="w-4 h-4" />
                          <span>
                            {project_.assignedTo.firstName} {project_.assignedTo.lastName}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <FolderOpen className="w-4 h-4" />
                        <span>{project_._count.documents} documents</span>
                      </div>
                      {project_.dueDate && (
                        <div className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          <span>Due {formatDate(project_.dueDate)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-[#A5A6AA]">
                    {formatDate(project_.createdAt)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {data.recentProjects.length > 0 && (
          <div className="p-4 border-t border-[#D4DADE] text-center">
            <Link href="/client-portal/projects">
              <Button
                variant="outline"
                className="text-[#005AF5] border-[#005AF5] hover:bg-[#005AF5] hover:text-white"
              >
                View All Projects
              </Button>
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
