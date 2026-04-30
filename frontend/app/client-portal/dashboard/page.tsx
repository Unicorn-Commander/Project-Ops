"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, FolderOpen, Calendar, User } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import {
  statusBadgeClass,
  priorityBadgeClass,
  iconWellClass,
} from "@/lib/badge-styles";
import { format } from "date-fns";
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted-foreground">Unable to load dashboard data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Welcome to Your Portal</h1>
        <p className="text-muted-foreground mt-1">
          View and manage your projects and documents
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Total Projects Card */}
        <Card className="p-6 bg-card border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Projects</p>
              <p className="text-3xl font-bold text-foreground mt-2">
                {data.totalProjects}
              </p>
            </div>
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconWellClass("primary")}`}>
              <FileText className="w-6 h-6" />
            </div>
          </div>
          <Link href="/client-portal/projects">
            <Button
              variant="link"
              className="text-primary hover:text-primary/90 p-0 mt-4"
            >
              View all projects →
            </Button>
          </Link>
        </Card>

        {/* Total Documents Card */}
        <Card className="p-6 bg-card border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Documents</p>
              <p className="text-3xl font-bold text-foreground mt-2">
                {data.totalDocuments}
              </p>
            </div>
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${iconWellClass("orange")}`}>
              <FolderOpen className="w-6 h-6" />
            </div>
          </div>
          <Link href="/client-portal/documents">
            <Button
              variant="link"
              className="text-primary hover:text-primary/90 p-0 mt-4"
            >
              View all documents →
            </Button>
          </Link>
        </Card>
      </div>

      {/* Recent Projects */}
      <Card className="bg-card border-border">
        <div className="p-6 border-b border-border">
          <h2 className="text-xl font-bold text-foreground">Recent Projects</h2>
        </div>

        {data.recentProjects.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No projects yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.recentProjects.map((project_) => (
              <Link
                key={project_.id}
                href={`/client-portal/projects/${project_.id}`}
                className="block p-6 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-sm font-mono text-muted-foreground">
                        #{project_.projectNumber}
                      </span>
                      <Badge className={statusBadgeClass(project_.status)}>
                        {project_.status.replace("_", " ")}
                      </Badge>
                      <Badge className={priorityBadgeClass(project_.priority)}>
                        {project_.priority}
                      </Badge>
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">
                      {project_.title}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
                          <span>Due {format(new Date(project_.dueDate), "MMM d, yyyy")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {format(new Date(project_.createdAt), "MMM d, yyyy")}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {data.recentProjects.length > 0 && (
          <div className="p-4 border-t border-border text-center">
            <Link href="/client-portal/projects">
              <Button
                variant="outline"
                className="text-primary border-primary hover:bg-primary hover:text-white"
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
