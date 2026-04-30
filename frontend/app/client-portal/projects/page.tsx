"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, FileText, FolderOpen, Calendar, User, Search } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import Link from "next/link";

interface Project {
  id: string;
  projectNumber: string;
  title: string;
  description: string | null;
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
}

export default function ClientProjectsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const response = await api.get("/client-portal/projects");
      setProjects(response.data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.response?.data?.message || "Failed to load projects",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredProjects = projects.filter((project_) => {
    const search = searchTerm.toLowerCase();
    return (
      project_.projectNumber.toLowerCase().includes(search) ||
      project_.title.toLowerCase().includes(search) ||
      (project_.description?.toLowerCase() || "").includes(search)
    );
  });

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
        <h1 className="text-3xl font-bold text-foreground">My Projects</h1>
        <p className="text-muted-foreground mt-1">View and track your projects</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search projects by project number, title, or description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Projects List */}
      {filteredProjects.length === 0 ? (
        <Card className="p-12 text-center bg-card border-border">
          <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            {searchTerm ? "No projects found matching your search" : "No projects yet"}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredProjects.map((project_) => (
            <Link key={project_.id} href={`/client-portal/projects/${project_.id}`}>
              <Card className="p-6 bg-card border-border hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
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
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(project_.createdAt), "MMM d, yyyy")}
                  </span>
                </div>

                <h3 className="text-lg font-semibold text-foreground mb-2">
                  {project_.title}
                </h3>

                {project_.description && (
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {project_.description}
                  </p>
                )}

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
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
