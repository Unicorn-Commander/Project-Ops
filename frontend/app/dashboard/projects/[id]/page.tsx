"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/use-toast";
import { EditProjectModal } from "@/components/modals/edit-project-modal";
import { StatusUpdate } from "@/components/project/status-update";
import { AssignProject } from "@/components/project/assign-project";
import { CommentThread } from "@/components/comments/comment-thread";
import { DocumentList } from "@/components/documents/document-list";
import { TaskList } from "@/components/tasks/task-list";
import { CreateTaskModal } from "@/components/modals/create-task-modal";
import { TaskDetailsModal } from "@/components/modals/task-details-modal";
import { EditTaskModal } from "@/components/modals/edit-task-modal";
import { getProjectTasks, Task } from "@/lib/tasks-api";
import api from "@/lib/api";
import {
  statusBadgeClass,
  priorityTextClass,
  paymentStatusBadgeClass,
} from "@/lib/badge-styles";
import { format } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  User,
  Mail,
  Phone,
  FileText,
  MessageSquare,
  Edit,
  AlertCircle,
  DollarSign,
  CheckSquare,
  Plus,
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
  assignedTo?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
  invoiceNumber?: string | null;
  billingAmount?: number | null;
  amountPaid?: number | null;
  paymentStatus?: string | null;
  billingDate?: string | null;
  paymentDueDate?: string | null;
  paymentReceivedDate?: string | null;
  billingNotes?: string | null;
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const [projectData, setProjectData] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [isTaskDetailsModalOpen, setIsTaskDetailsModalOpen] = useState(false);
  const [isEditTaskModalOpen, setIsEditTaskModalOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchProjectDetails();
    fetchUserRole();
    fetchProjectTasks();
  }, [projectId]);

  const fetchUserRole = () => {
    if (typeof window !== "undefined") {
      const user = localStorage.getItem("user");
      if (user) {
        const userData = JSON.parse(user);
        setUserRole(userData.role);
      }
    }
  };

  const fetchProjectDetails = async () => {
    try {
      const response = await api.get(`/projects/${projectId}`);
      setProjectData(response.data);
      setLoading(false);
    } catch (error: any) {
      console.error("Error fetching project:", error);
      toast({
        title: "Error",
        description: "Failed to load project details",
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const fetchProjectTasks = async () => {
    setLoadingTasks(true);
    try {
      const response = await getProjectTasks(projectId);
      setTasks(response.data || []);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      setTasks([]);
    } finally {
      setLoadingTasks(false);
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsTaskDetailsModalOpen(true);
  };

  const handleEditTaskClick = () => {
    setIsTaskDetailsModalOpen(false);
    setIsEditTaskModalOpen(true);
  };

  const handleTaskUpdate = () => {
    fetchProjectTasks();
  };

  const getStatusColor = statusBadgeClass;
  const getPriorityColor = priorityTextClass;
  const getPaymentStatusColor = paymentStatusBadgeClass;

  const canEditProject = () => {
    return (
      userRole === "ADMIN" ||
      userRole === "MANAGER" ||
      userRole === "STAFF"
    );
  };

  const canAssignProject = () => {
    return userRole === "ADMIN" || userRole === "MANAGER";
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Card className="p-6 space-y-3">
              <Skeleton className="h-5 w-40" />
              <SkeletonText lines={4} />
            </Card>
            <Card className="p-6 space-y-3">
              <Skeleton className="h-5 w-32" />
              {[1, 2, 3].map((i) => <SkeletonText key={i} lines={2} />)}
            </Card>
          </div>
          <div className="space-y-6">
            <Card className="p-6 space-y-3">
              <Skeleton className="h-5 w-24" />
              <SkeletonText lines={5} />
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (!projectData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Project Not Found</h3>
        <p className="text-muted-foreground mb-4">
          The project you're looking for doesn't exist or has been deleted.
        </p>
        <Button onClick={() => router.push("/dashboard/projects")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Projects
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/projects")}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold text-foreground">
                {projectData.title}
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(
                  projectData.status
                )}`}
              >
                {projectData.status.replace("_", " ")}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Project #{projectData.projectNumber}
            </p>
          </div>
        </div>
        {canEditProject() && (
          <Button
            className="bg-primary hover:bg-primary/90"
            onClick={() => setEditModalOpen(true)}
          >
            <Edit className="mr-2 h-4 w-4" />
            Edit Project
          </Button>
        )}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Project Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Project Information */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Project Information</h2>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Description
                </label>
                <p className="text-foreground mt-1">{projectData.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                  </label>
                </div>

                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Priority
                  </label>
                  <p
                    className={`mt-1 font-semibold ${getPriorityColor(
                      projectData.priority
                    )}`}
                  >
                    {projectData.priority}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Due Date
                  </label>
                  <p className="text-foreground mt-1">
                    {projectData.dueDate
                      ? format(new Date(projectData.dueDate), "MMM d, yyyy")
                      : "Not set"}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Created
                  </label>
                  <p className="text-foreground mt-1">
                    {format(new Date(projectData.createdAt), "MMM d, yyyy")}
                  </p>
                </div>
              </div>
            </div>
          </Card>

          {/* Client Information */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Client Information</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium">{projectData.clientName}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium">{projectData.clientEmail}</p>
                </div>
              </div>

              {projectData.clientPhone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Phone</p>
                    <p className="font-medium">{projectData.clientPhone}</p>
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Billing Information */}
          {(projectData.invoiceNumber || projectData.billingAmount || projectData.paymentStatus) && (
            <Card className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <DollarSign className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Billing & Invoicing</h2>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {projectData.invoiceNumber && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Invoice Number
                      </label>
                      <p className="text-foreground mt-1 font-mono">{projectData.invoiceNumber}</p>
                    </div>
                  )}

                  {projectData.paymentStatus && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Payment Status
                      </label>
                      <div className="mt-1">
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${getPaymentStatusColor(
                            projectData.paymentStatus
                          )}`}
                        >
                          {projectData.paymentStatus.replace("_", " ")}
                        </span>
                      </div>
                    </div>
                  )}

                  {projectData.billingAmount && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Billing Amount
                      </label>
                      <p className="text-foreground mt-1 font-semibold">
                        ${Number(projectData.billingAmount).toFixed(2)}
                      </p>
                    </div>
                  )}

                  {projectData.amountPaid !== null && projectData.amountPaid !== undefined && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Amount Paid
                      </label>
                      <p className="text-foreground mt-1 font-semibold">
                        ${Number(projectData.amountPaid).toFixed(2)}
                      </p>
                    </div>
                  )}

                  {projectData.billingDate && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Billing Date
                      </label>
                      <p className="text-foreground mt-1">
                        {format(new Date(projectData.billingDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  )}

                  {projectData.paymentDueDate && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Payment Due Date
                      </label>
                      <p className="text-foreground mt-1">
                        {format(new Date(projectData.paymentDueDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  )}

                  {projectData.paymentReceivedDate && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Payment Received
                      </label>
                      <p className="text-foreground mt-1">
                        {format(new Date(projectData.paymentReceivedDate), "MMM d, yyyy")}
                      </p>
                    </div>
                  )}
                </div>

                {projectData.billingNotes && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">
                      Billing Notes
                    </label>
                    <p className="text-foreground mt-1 text-sm bg-muted p-3 rounded-md">
                      {projectData.billingNotes}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Tasks */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">Tasks ({tasks.length})</h2>
              </div>
              {canEditProject() && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsCreateTaskModalOpen(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Task
                </Button>
              )}
            </div>
            {loadingTasks ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">Loading tasks...</p>
              </div>
            ) : (
              <TaskList
                tasks={tasks}
                onTaskClick={handleTaskClick}
                emptyMessage="No tasks for this project yet"
              />
            )}
          </Card>

          {/* Documents */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Documents</h2>
            <DocumentList projectId={projectId} />
          </Card>

          {/* Comments */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Comments & Notes</h2>
            <CommentThread projectId={projectId} />
          </Card>
        </div>

        {/* Right Column - Actions & Status */}
        <div className="space-y-6">
          {/* Status & Assignment */}
          {canEditProject() && (
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Project Management</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-2 block">
                    Status
                  </label>
                  <StatusUpdate
                    projectId={projectData.id}
                    currentStatus={projectData.status}
                    onSuccess={fetchProjectDetails}
                  />
                </div>

                {canAssignProject() && (
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-2 block">
                      Assigned To
                    </label>
                    <AssignProject
                      projectId={projectData.id}
                      currentAssignedToId={projectData.assignedToId}
                      onSuccess={fetchProjectDetails}
                    />
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Activity Timeline */}
          <Card className="p-6">
            <h2 className="text-lg font-semibold mb-4">Activity Timeline</h2>
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-primary" />
                  </div>
                  <div className="w-px h-full bg-border mt-2"></div>
                </div>
                <div className="pb-4">
                  <p className="text-sm font-medium">Project Created</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(projectData.createdAt), "MMM d, yyyy h:mm a")}
                  </p>
                </div>
              </div>

              {projectData.updatedAt !== projectData.createdAt && (
                <div className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Edit className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Project Updated</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(projectData.updatedAt), "MMM d, yyyy h:mm a")}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Modals */}
      <EditProjectModal
        projectData={projectData}
        isOpen={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        onSuccess={fetchProjectDetails}
      />

      <CreateTaskModal
        isOpen={isCreateTaskModalOpen}
        onClose={() => setIsCreateTaskModalOpen(false)}
        onSuccess={handleTaskUpdate}
        preselectedProjectId={projectId}
      />

      <TaskDetailsModal
        isOpen={isTaskDetailsModalOpen}
        onClose={() => {
          setIsTaskDetailsModalOpen(false);
          setSelectedTask(null);
        }}
        task={selectedTask}
        onEdit={handleEditTaskClick}
        onUpdate={handleTaskUpdate}
      />

      <EditTaskModal
        isOpen={isEditTaskModalOpen}
        onClose={() => {
          setIsEditTaskModalOpen(false);
          setSelectedTask(null);
        }}
        onSuccess={() => {
          handleTaskUpdate();
          setSelectedTask(null);
        }}
        task={selectedTask}
      />
    </div>
  );
}
