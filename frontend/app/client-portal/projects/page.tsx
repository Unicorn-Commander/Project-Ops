"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  FileText,
  FolderOpen,
  Calendar,
  User,
  Search,
  ArrowRight,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useHydrated } from "@/lib/use-hydrated";
import api from "@/lib/api";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/badge-styles";
import { format } from "date-fns";
import Link from "next/link";
import { PortalPageHeader, PortalEmpty } from "@/components/portal";

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
  const hydrated = useHydrated();
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
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PortalPageHeader
        icon={FileText}
        title="Your projects"
        subtitle="Everything we're working on together — open any project to follow its progress, see documents, and message your team."
      />

      {/* Search — only worth showing once there's something to search. */}
      {projects.length > 0 && (
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search by name, number, or description…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="h-11 pl-11"
            aria-label="Search projects"
          />
        </div>
      )}

      {/* Projects list */}
      {filteredProjects.length === 0 ? (
        searchTerm ? (
          <PortalEmpty
            icon={Search}
            iconTone="zinc"
            title="No matching projects"
            body={`Nothing matched "${searchTerm}". Try a different name or project number.`}
          />
        ) : (
          <PortalEmpty
            icon={FileText}
            title="Your projects will appear here"
            body="As soon as we kick off work together, each project shows up here with its status, documents, and a place to talk with your team."
          />
        )
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredProjects.map((project_) => (
            <Link key={project_.id} href={`/client-portal/projects/${project_.id}`}>
              <Card className="group cursor-pointer bg-card p-6 transition-shadow duration-200 hover:shadow-md">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      #{project_.projectNumber}
                    </span>
                    <Badge className={statusBadgeClass(project_.status)}>
                      {project_.status.replace("_", " ")}
                    </Badge>
                    <Badge className={priorityBadgeClass(project_.priority)}>
                      {project_.priority}
                    </Badge>
                  </div>
                  {hydrated && (
                    <span className="whitespace-nowrap text-sm text-muted-foreground">
                      {format(new Date(project_.createdAt), "MMM d, yyyy")}
                    </span>
                  )}
                </div>

                <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground transition-colors group-hover:text-primary">
                  {project_.title}
                  <ArrowRight className="h-4 w-4 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </h3>

                {project_.description && (
                  <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                    {project_.description}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {project_.assignedTo && (
                    <span className="inline-flex items-center gap-1.5">
                      <User className="h-4 w-4" />
                      {project_.assignedTo.firstName} {project_.assignedTo.lastName}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5">
                    <FolderOpen className="h-4 w-4" />
                    {project_._count.documents}{" "}
                    {project_._count.documents === 1 ? "document" : "documents"}
                  </span>
                  {project_.dueDate && hydrated && (
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="h-4 w-4" />
                      Due {format(new Date(project_.dueDate), "MMM d, yyyy")}
                    </span>
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
