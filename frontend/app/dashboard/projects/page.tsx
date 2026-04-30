"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CreateProjectModal } from "@/components/modals/create-project-modal";
import { EditProjectModal } from "@/components/modals/edit-project-modal";
import { StatusUpdate } from "@/components/project/status-update";
import { AssignProject } from "@/components/project/assign-project";
import api from "@/lib/api";
import {
  statusBadgeClass,
  priorityTextClass,
  paymentStatusBadgeClass,
} from "@/lib/badge-styles";
import { format } from "date-fns";
import {
  FileText,
  Search,
  Filter,
  Plus,
  Calendar,
  User,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  DollarSign,
} from "lucide-react";

interface Project {
  id: string;
  projectNumber: string;
  title: string;
  description: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedToId: string | null;
  createdAt: string;
  invoiceNumber?: string | null;
  billingAmount?: number | null;
  amountPaid?: number | null;
  paymentStatus?: string | null;
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterPriority, setFilterPriority] = useState("ALL");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchProjects();
    fetchUserRole();
  }, []);

  const fetchUserRole = () => {
    if (typeof window !== "undefined") {
      const user = localStorage.getItem("user");
      if (user) {
        const userData = JSON.parse(user);
        setUserRole(userData.role);
      }
    }
  };

  const fetchProjects = async () => {
    try {
      const response = await api.get("/projects?page=1&limit=100");
      setProjects(response.data.data || []);
      setLoading(false);
    } catch (error) {
      // Error handling - always show errors
      toast({
        title: "Error",
        description: "Failed to load projects",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const handleEditProject = (projectItem: Project) => {
    setSelectedProject(projectItem);
    setEditModalOpen(true);
  };

  const handleDeleteClick = (projectItem: Project) => {
    setProjectToDelete(projectItem);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;

    setDeleting(true);
    try {
      await api.delete(`/projects/${projectToDelete.id}`);

      toast({
        title: "Project Deleted",
        description: `Case ${projectToDelete.projectNumber} has been deleted successfully`,
      });

      fetchProjects();
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    } catch (error: any) {
      toast({
        title: "Error",
        description:
          error.response?.data?.message || "Failed to delete project",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const canEditProject = () => {
    return (
      userRole === "ADMIN" ||
      userRole === "MANAGER" ||
      userRole === "STAFF"
    );
  };

  const canDeleteProject = () => {
    return userRole === "ADMIN" || userRole === "MANAGER";
  };

  const canAssignProject = () => {
    return userRole === "ADMIN" || userRole === "MANAGER";
  };

  const getStatusColor = statusBadgeClass;
  const getPriorityColor = priorityTextClass;
  const getPaymentStatusColor = paymentStatusBadgeClass;

  const filteredProjects = projects.filter((c) => {
    const matchesSearch =
      c.projectNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.clientName.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === "ALL" || c.status === filterStatus;
    const matchesPriority = filterPriority === "ALL" || c.priority === filterPriority;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const statusCounts = {
    ALL: projects.length,
    NEW: projects.filter((c) => c.status === "NEW").length,
    IN_PROGRESS: projects.filter((c) => c.status === "IN_PROGRESS").length,
    UNDER_REVIEW: projects.filter((c) => c.status === "UNDER_REVIEW").length,
    COMPLETED: projects.filter((c) => c.status === "COMPLETED").length,
  };

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
          <h1 className="text-3xl font-bold text-foreground">Projects</h1>
          <p className="text-muted-foreground mt-1">
            Manage and track projects
          </p>
        </div>
        <Button
          className="bg-primary hover:bg-primary/90"
          onClick={() => setCreateModalOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Object.entries(statusCounts).map(([status, count]) => (
          <Card
            key={status}
            className={`p-4 cursor-pointer transition-shadow hover:shadow-md ${
              filterStatus === status ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => setFilterStatus(status)}
          >
            <div className="text-sm font-medium text-muted-foreground">
              {status.replace("_", " ")}
            </div>
            <div className="text-2xl font-bold mt-2">{count}</div>
          </Card>
        ))}
      </div>

      {/* Search and Filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="px-4 py-2 border border-input rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="ALL">All Priorities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="URGENT">Urgent</option>
        </select>
        <Button variant="outline">
          <Filter className="mr-2 h-4 w-4" />
          Filters
        </Button>
      </div>

      {/* Projects Grid */}
      <div className="grid gap-4">
        {filteredProjects.map((projectItem) => (
          <Card key={projectItem.id} className="p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="font-mono text-sm font-medium text-muted-foreground">
                    {projectItem.projectNumber}
                  </span>

                  {canEditProject() ? (
                    <StatusUpdate
                      projectId={projectItem.id}
                      currentStatus={projectItem.status}
                      onSuccess={fetchProjects}
                    />
                  ) : (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                        projectItem.status
                      )}`}
                    >
                      {projectItem.status.replace("_", " ")}
                    </span>
                  )}

                  <span
                    className={`text-xs font-semibold ${getPriorityColor(
                      projectItem.priority
                    )}`}
                  >
                    {projectItem.priority}
                  </span>

                  {projectItem.paymentStatus && (
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getPaymentStatusColor(
                        projectItem.paymentStatus
                      )}`}
                    >
                      <DollarSign className="h-3 w-3 inline mr-1" />
                      {projectItem.paymentStatus.replace("_", " ")}
                    </span>
                  )}
                </div>

                <h3
                  className="text-lg font-semibold text-foreground mb-2 cursor-pointer hover:text-primary"
                  onClick={() => router.push(`/dashboard/projects/${projectItem.id}`)}
                >
                  {projectItem.title}
                </h3>
                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                  {projectItem.description}
                </p>

                <div className="flex items-center gap-6 text-sm text-muted-foreground flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <User className="h-4 w-4" />
                    <span>{projectItem.clientName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-4 w-4" />
                  </div>
                  {projectItem.dueDate && (
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4" />
                      <span>
                        Due: {format(new Date(projectItem.dueDate), "MMM d, yyyy")}
                      </span>
                    </div>
                  )}
                  {projectItem.billingAmount && (
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="h-4 w-4" />
                      <span className="font-semibold">
                        ${Number(projectItem.billingAmount).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/dashboard/projects/${projectItem.id}`)}
                >
                  <Eye className="h-4 w-4 mr-2" />
                  View
                </Button>

                {canEditProject() && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditProject(projectItem)}
                  >
                    <Edit className="h-4 w-4 mr-2" />
                    Edit
                  </Button>
                )}

                {canAssignProject() && (
                  <AssignProject
                    projectId={projectItem.id}
                    currentAssignedToId={projectItem.assignedToId}
                    onSuccess={fetchProjects}
                  />
                )}

                {canDeleteProject() && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10"
                    onClick={() => handleDeleteClick(projectItem)}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {filteredProjects.length === 0 && (
        <Card className="p-12 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-semibold mb-2">No projects found</h3>
          <p className="text-muted-foreground mb-4">
            {searchTerm
              ? "Try adjusting your search criteria"
              : "Get started by creating a new project"}
          </p>
          <Button
            className="bg-primary hover:bg-primary/90"
            onClick={() => setCreateModalOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create New Project
          </Button>
        </Card>
      )}

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => {
          fetchProjects();
          setCreateModalOpen(false);
        }}
      />

      {/* Edit Project Modal */}
      <EditProjectModal
        projectData={selectedProject}
        isOpen={editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setSelectedProject(null);
        }}
        onSuccess={fetchProjects}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete project{" "}
              <span className="font-semibold">{projectToDelete?.projectNumber}</span>?
              This action cannot be undone and will permanently remove the project
              and all associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete Project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
