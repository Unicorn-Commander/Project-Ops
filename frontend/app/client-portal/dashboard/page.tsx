"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  FileText,
  FolderOpen,
  Calendar,
  User,
  ArrowRight,
  ClipboardCheck,
} from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import api from "@/lib/api";
import { statusBadgeClass, priorityBadgeClass } from "@/lib/badge-styles";
import { getStoredWorkspaces } from "@/lib/workspace";
import { useHydrated } from "@/lib/use-hydrated";
import { format } from "date-fns";
import Link from "next/link";
import {
  PortalHeader,
  PortalWelcome,
  StatCard,
  PortalEmpty,
} from "@/components/portal";

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
  const { toast } = useToast();
  const hydrated = useHydrated();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);

  // Identity for the hero. Read in an effect (localStorage) so the server and
  // first client render agree — see lib/use-hydrated. #418-safe.
  const [firstName, setFirstName] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) setFirstName(JSON.parse(raw)?.firstName ?? null);
    } catch {
      /* best-effort personalisation */
    }
    const ws = getStoredWorkspaces();
    if (ws.length > 0) setOrgName(ws[0].displayName ?? null);
  }, []);

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
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-8">
        <PortalHeader firstName={firstName} orgName={orgName} />
        <PortalEmpty
          icon={FileText}
          title="We couldn't load your dashboard"
          body="Please refresh the page in a moment. If it keeps happening, reach out to your team and we'll sort it out."
        />
      </div>
    );
  }

  const hasProjects = data.totalProjects > 0;

  return (
    <div className="space-y-8">
      {/* Branded welcome hero */}
      <PortalHeader firstName={firstName} orgName={orgName} />

      {/* First-run welcome — dismissible, persists via the guidance kit. */}
      <PortalWelcome hasProjects={hasProjects} />

      {/* Summary */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <StatCard
          icon={FileText}
          tone="primary"
          label="Your projects"
          value={data.totalProjects}
          hint={hasProjects ? "Active work we're doing together" : "Nothing here just yet"}
          href="/client-portal/projects"
          linkLabel="View all projects"
        />
        <StatCard
          icon={FolderOpen}
          tone="violet"
          label="Shared documents"
          value={data.totalDocuments}
          hint={
            data.totalDocuments > 0
              ? "Files we've shared with you"
              : "Documents will appear here"
          }
          href="/client-portal/documents"
          linkLabel="View all documents"
        />
      </div>

      {/* Recent projects */}
      <Card className="bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 className="text-lg font-bold text-foreground">Recent projects</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The latest of what we're working on for you
            </p>
          </div>
          {hasProjects && (
            <Link
              href="/client-portal/projects"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              See all
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>

        {data.recentProjects.length === 0 ? (
          <div className="p-6">
            <PortalEmpty
              icon={ClipboardCheck}
              iconTone="primary"
              title="Your projects will show up here"
              body="As soon as we start work together, you'll see every project, its progress, and the documents we share — all in one place."
              className="border-dashed"
            />
          </div>
        ) : (
          <div className="divide-y divide-border">
            {data.recentProjects.map((project_) => (
              <Link
                key={project_.id}
                href={`/client-portal/projects/${project_.id}`}
                className="group block px-6 py-5 transition-colors hover:bg-muted/40"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
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
                    <h3 className="text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                      {project_.title}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                      {project_.assignedTo && (
                        <span className="inline-flex items-center gap-1.5">
                          <User className="h-4 w-4" />
                          {project_.assignedTo.firstName}{" "}
                          {project_.assignedTo.lastName}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1.5">
                        <FolderOpen className="h-4 w-4" />
                        {project_._count.documents}{" "}
                        {project_._count.documents === 1 ? "document" : "documents"}
                      </span>
                      {project_.dueDate && (
                        <span className="inline-flex items-center gap-1.5">
                          <Calendar className="h-4 w-4" />
                          Due{" "}
                          {hydrated
                            ? format(new Date(project_.dueDate), "MMM d, yyyy")
                            : "—"}
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
