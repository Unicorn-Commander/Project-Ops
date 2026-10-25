"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { EditProjectModal } from "@/components/modals/edit-project-modal";
import { StatusUpdate } from "@/components/project/status-update";
import { AssignProject } from "@/components/project/assign-project";
import { CommentThread } from "@/components/comments/comment-thread";
import { SITE_HOST } from "@/lib/site";
import { DocumentList } from "@/components/documents/document-list";
import { TaskList } from "@/components/tasks/task-list";
import { ProjectSnapshot } from "@/components/project/project-snapshot";
import { BudgetPanel, type ProjectBudget } from "@/components/schedule/budget";
import { QuotePanel } from "@/components/project/quote-panel";
import { TaskTimeline } from "@/components/schedule/task-timeline";
import { EmptyState } from "@/components/ui/empty-state";
import { recordVisit } from "@/lib/recently-visited";
import { CreateTaskModal } from "@/components/modals/create-task-modal";
import { TaskDetailsModal } from "@/components/modals/task-details-modal";
import { EditTaskModal } from "@/components/modals/edit-task-modal";
import { getProjectTasks, getTask, Task } from "@/lib/tasks-api";
import api from "@/lib/api";
import {
  statusBadgeClass,
  priorityTextClass,
  paymentStatusBadgeClass,
} from "@/lib/badge-styles";
import { projectColorClasses } from "@/lib/project-colors";
import {
  requestApproval,
  getProjectApprovals,
  approvalStatusLabel,
  approvalStatusBadgeClass,
  entityTypeLabel,
  type PortalApproval,
  type ApprovalEntityType,
} from "@/lib/portal-api";
import { format } from "date-fns";
import { formatDateOnly } from "@/lib/date-only";
import {
  ArrowLeft,
  Calendar,
  User,
  Mail,
  Phone,
  FileText,
  MessageSquare,
  Edit,
  DollarSign,
  CheckSquare,
  Plus,
  Printer,
  FolderX,
  GanttChartSquare,
  ChevronDown,
  ClipboardCheck,
  Loader2,
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
  category?: string | null;
  tags?: string[] | null;
  dueDate: string | null;
  assignedToId: string | null;
  assignedTo?: {
    firstName: string;
    lastName: string;
    email: string;
  };
  contact?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
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
  const searchParams = useSearchParams();
  const projectId = params.id as string;
  const taskId = searchParams.get("taskId");
  const [projectData, setProjectData] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [budget, setBudget] = useState<ProjectBudget | null>(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [loadedTasksProjectId, setLoadedTasksProjectId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [isTaskDetailsModalOpen, setIsTaskDetailsModalOpen] = useState(false);
  const [isEditTaskModalOpen, setIsEditTaskModalOpen] = useState(false);
  const openedTaskIdRef = useRef<string | null>(null);
  const fetchingDeepLinkedTaskRef = useRef<string | null>(null);
  // Timeline section open/closed. Open by default so dependency arrows are
  // discoverable; collapsible to keep the long detail page tidy.
  const [timelineOpen, setTimelineOpen] = useState(true);

  // ── Request-client-approval (staff → portal) ──────────────────────────────
  // Loaded live from the staff-readable GET /client-portal/approvals/by-project/:id
  // (fetchProjectApprovals), so staff see real client decisions; a fresh request
  // is also optimistically prepended on create.
  // The client decides them in their portal; reading those decisions back here
  // would need a staff list endpoint that does not exist yet.
  const [approvalDialogOpen, setApprovalDialogOpen] = useState(false);
  const [approvalEntityType, setApprovalEntityType] =
    useState<ApprovalEntityType>("DELIVERABLE");
  const [approvalApprover, setApprovalApprover] = useState<string>("ANY");
  const [approvalNote, setApprovalNote] = useState("");
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [requestedApprovals, setRequestedApprovals] = useState<PortalApproval[]>([]);

  const { toast } = useToast();

  useEffect(() => {
    fetchProjectDetails();
    fetchUserRole();
    fetchProjectTasks();
    fetchBudget();
    fetchProjectApprovals();
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
      // Track for the Cmd+K Recent section (v1.6.46).
      recordVisit({
        id: response.data.id,
        type: "project",
        title: response.data.title,
        subtitle: `${response.data.projectNumber}${response.data.clientName ? " · " + response.data.clientName : ""}`,
        href: `/dashboard/projects/${response.data.id}`,
      });
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
    setLoadedTasksProjectId(null);
    try {
      const projectTasks = await getProjectTasks(projectId);
      setTasks(projectTasks || []);
      setLoadedTasksProjectId(projectId);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      setTasks([]);
      setLoadedTasksProjectId(projectId);
    } finally {
      setLoadingTasks(false);
    }
  };

  // Live client decisions on this project's approval requests (staff view, via
  // the staff-readable GET /client-portal/approvals/by-project/:id). Fails soft:
  // clients never reach this page, and a 403/404 just leaves the list empty.
  const fetchProjectApprovals = async () => {
    try {
      const res = await getProjectApprovals(projectId);
      setRequestedApprovals(res.data);
    } catch {
      // staff-only endpoint — ignore for non-staff / not-found
    }
  };

  // Budget burn-down — hours logged vs budget + amount billed vs budget.
  // Fails soft: a 404 (endpoint not yet provisioned, or no budget for
  // this project) or any error just leaves `budget` null and the panel
  // hides, rather than surfacing a scary toast.
  const fetchBudget = async () => {
    try {
      const response = await api.get(`/projects/${projectId}/budget`);
      setBudget(response.data as ProjectBudget);
    } catch {
      setBudget(null);
    }
  };

  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task);
    setIsTaskDetailsModalOpen(true);
  }, []);

  const clearTaskIdFromUrl = () => {
    if (!searchParams.get("taskId")) return;
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    nextSearchParams.delete("taskId");
    const query = nextSearchParams.toString();
    router.replace(`/dashboard/projects/${projectId}${query ? `?${query}` : ""}`);
  };

  // Activity-feed and palette links carry taskId on the project URL. Prefer
  // the already-loaded project task, but fall back to the task endpoint for a
  // task omitted by the project listing (for example, due to pagination or a
  // stale project link).
  useEffect(() => {
    if (!taskId) {
      openedTaskIdRef.current = null;
      fetchingDeepLinkedTaskRef.current = null;
      return;
    }
    if (
      loadingTasks ||
      loadedTasksProjectId !== projectId ||
      openedTaskIdRef.current === taskId ||
      fetchingDeepLinkedTaskRef.current === taskId
    ) {
      return;
    }

    const matchingTask = tasks.find((task) => task.id === taskId);
    if (matchingTask) {
      openedTaskIdRef.current = taskId;
      handleTaskClick(matchingTask);
      return;
    }

    let cancelled = false;
    fetchingDeepLinkedTaskRef.current = taskId;
    getTask(taskId)
      .then((task) => {
        if (cancelled) return;
        openedTaskIdRef.current = taskId;
        handleTaskClick(task);
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Error fetching deep-linked task:", error);
        }
      })
      .finally(() => {
        if (fetchingDeepLinkedTaskRef.current === taskId) {
          fetchingDeepLinkedTaskRef.current = null;
        }
      });

    return () => {
      cancelled = true;
    };
  }, [handleTaskClick, loadedTasksProjectId, loadingTasks, projectId, taskId, tasks]);

  const handleEditTaskClick = () => {
    setIsTaskDetailsModalOpen(false);
    setIsEditTaskModalOpen(true);
    clearTaskIdFromUrl();
  };

  const handleTaskUpdate = () => {
    fetchProjectTasks();
  };

  const resetApprovalForm = () => {
    setApprovalEntityType("DELIVERABLE");
    setApprovalApprover("ANY");
    setApprovalNote("");
  };

  const handleRequestApproval = async () => {
    if (requestingApproval) return;
    setRequestingApproval(true);
    try {
      // For DOCUMENT/DELIVERABLE the backend wants the entity's own id; we
      // don't have a per-deliverable picker here, so the entity is the project
      // itself (the approval is still attached to this project via projectId,
      // which is what drives client scoping).
      const created = await requestApproval({
        entityType: approvalEntityType,
        entityId: projectId,
        projectId,
        approverContactId:
          approvalApprover === "ANY" ? undefined : approvalApprover,
        note: approvalNote.trim() || undefined,
      });
      setRequestedApprovals((prev) => [created, ...prev]);
      toast({
        title: "Approval requested",
        description:
          "The client will see this in their portal and can approve, reject, or request changes.",
      });
      setApprovalDialogOpen(false);
      resetApprovalForm();
    } catch (error: any) {
      toast({
        title: "Could not request approval",
        description:
          error.response?.data?.message || "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setRequestingApproval(false);
    }
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
      <EmptyState
        icon={FolderX}
        iconTone="rose"
        title="Project not found"
        body="The project you're looking for doesn't exist or has been deleted."
        className="min-h-[400px]"
        action={
          <Button onClick={() => router.push("/dashboard/projects")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to projects
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Print-only header (v1.6.56) — replaces the interactive header at
          print time. Project number, title, status, and a date stamp so
          the printout is self-contained. */}
      <div className="print-only">
        <div style={{ borderBottom: "1px solid #d4d4d8", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
          <div style={{ fontSize: "10pt", fontFamily: "monospace", color: "#52525b" }}>
            {projectData.projectNumber} · {projectData.status.replace(/_/g, " ")}
          </div>
          <h1 style={{ fontSize: "20pt", margin: "0.25rem 0 0 0" }}>
            {projectData.title}
          </h1>
          <div style={{ fontSize: "9pt", color: "#71717a", marginTop: "0.25rem" }}>
            Printed {format(new Date(), "MMM d, yyyy 'at' h:mm a")} · {SITE_HOST}
          </div>
        </div>
      </div>

      {/* Interactive header — hidden in print mode (v1.6.56). */}
      <div className="flex items-center justify-between no-print">
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
            {(() => {
              const pc = projectColorClasses(projectData.id);
              return (
                <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-xs font-medium ${pc.badgeBg} ${pc.badgeText}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${pc.dot}`} />
                  {projectData.projectNumber}
                </span>
              );
            })()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => window.print()}
            title="Print this project as a paper status report"
          >
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
          {canEditProject() && (
            <Button
              variant="outline"
              onClick={() => setApprovalDialogOpen(true)}
              title="Ask the client to approve a document, deliverable, or the project"
            >
              <ClipboardCheck className="mr-2 h-4 w-4" />
              Request approval
            </Button>
          )}
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
                    Category
                  </label>
                  <p className="text-foreground mt-1">
                    {projectData.category || "Uncategorized"}
                  </p>
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
                      ? formatDateOnly(projectData.dueDate)
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

              {Array.isArray(projectData.tags) && projectData.tags.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {projectData.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
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

          {/* Quote — the accepted Customer-Ops quote this project came from
              (QUOTES-CONTRACT-v1 §3): number, status, totals, share link, read
              through to Customer-Ops. Sits above billing because it is the
              commercial paper the billing fields were mirrored from. Self-hides
              when the project has no quote. */}
          <QuotePanel endpoint={`/projects/${projectId}/quote`} variant="staff" />

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
                        {formatDateOnly(projectData.billingDate)}
                      </p>
                    </div>
                  )}

                  {projectData.paymentDueDate && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Payment Due Date
                      </label>
                      <p className="text-foreground mt-1">
                        {formatDateOnly(projectData.paymentDueDate)}
                      </p>
                    </div>
                  )}

                  {projectData.paymentReceivedDate && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">
                        Payment Received
                      </label>
                      <p className="text-foreground mt-1">
                        {formatDateOnly(projectData.paymentReceivedDate)}
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

          {/* Budget burn-down — hours logged vs budget + amount billed vs
              budget, each with a clear over-budget state. Sits next to
              billing since it's the money view. Self-hides when no budget
              is set on the project. */}
          <BudgetPanel budget={budget} />

          {/* Snapshot — completion + status donut + priority bar (v1.6.35).
              Sits above the task list so the project's shape reads at
              a glance before scrolling. Hidden when there are no tasks
              (component renders a friendly empty card instead). */}
          {!loadingTasks && <ProjectSnapshot tasks={tasks} />}

          {/* Timeline — a task-level Gantt that visualizes dependencies as
              arrows (predecessor → successor). Collapsible so it doesn't
              crowd the page; hidden in print since the SVG overlay is measured
              at runtime. (v1.6.x) */}
          <Card className="p-0 overflow-hidden no-print">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-6 py-4 text-left hover:bg-muted/30 transition-colors"
              onClick={() => setTimelineOpen((o) => !o)}
              aria-expanded={timelineOpen}
            >
              <span className="flex items-center gap-2">
                <GanttChartSquare className="h-5 w-5 text-primary" />
                <span className="text-lg font-semibold">Timeline</span>
                <span className="text-sm text-muted-foreground">
                  Schedule & dependencies
                </span>
              </span>
              <ChevronDown
                className={`h-5 w-5 text-muted-foreground transition-transform duration-200 ${
                  timelineOpen ? "" : "-rotate-90"
                }`}
              />
            </button>
            {timelineOpen && (
              <div className="px-6 pb-6 pt-0 border-t">
                <div className="pt-4">
                  <TaskTimeline
                    projectId={projectId}
                    onTaskClick={handleTaskClick}
                  />
                </div>
              </div>
            )}
          </Card>

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

          {/* Client Approvals */}
          {canEditProject() && (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Client Approvals</h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setApprovalDialogOpen(true)}
                >
                  <ClipboardCheck className="mr-2 h-4 w-4" />
                  Request
                </Button>
              </div>
              {requestedApprovals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No approval requests yet. Use{" "}
                  <span className="font-medium text-foreground">Request</span> to
                  ask the client to sign off on a document, deliverable, or the
                  project.
                </p>
              ) : (
                <div className="space-y-3">
                  {requestedApprovals.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {entityTypeLabel(a.entityType)}
                        </p>
                        {a.note && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {a.note}
                          </p>
                        )}
                      </div>
                      <Badge className={approvalStatusBadgeClass(a.status)}>
                        {approvalStatusLabel(a.status)}
                      </Badge>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Shows requests made here. The client&apos;s decision appears
                    in their portal.
                  </p>
                </div>
              )}
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
          clearTaskIdFromUrl();
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
          clearTaskIdFromUrl();
        }}
        onSuccess={() => {
          handleTaskUpdate();
          setSelectedTask(null);
        }}
        task={selectedTask}
      />

      {/* Request client approval */}
      <Dialog
        open={approvalDialogOpen}
        onOpenChange={(open) => {
          setApprovalDialogOpen(open);
          if (!open) resetApprovalForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request client approval</DialogTitle>
            <DialogDescription>
              Ask the client to sign off on this project. They&apos;ll approve,
              request changes, or reject it from their portal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="approval-entity-type">What needs approval?</Label>
              <Select
                value={approvalEntityType}
                onValueChange={(v) =>
                  setApprovalEntityType(v as ApprovalEntityType)
                }
              >
                <SelectTrigger id="approval-entity-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DELIVERABLE">Deliverable</SelectItem>
                  <SelectItem value="DOCUMENT">Document</SelectItem>
                  <SelectItem value="PROJECT">Project</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="approval-approver">Approver</Label>
              <Select
                value={approvalApprover}
                onValueChange={setApprovalApprover}
              >
                <SelectTrigger id="approval-approver">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ANY">
                    Any client on this project
                  </SelectItem>
                  {projectData.contact && (
                    <SelectItem value={projectData.contact.id}>
                      {projectData.contact.firstName}{" "}
                      {projectData.contact.lastName}
                      {projectData.contact.email
                        ? ` (${projectData.contact.email})`
                        : ""}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="approval-note">
                Note{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="approval-note"
                placeholder="e.g. Please review the final deliverable and approve."
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApprovalDialogOpen(false)}
              disabled={requestingApproval}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRequestApproval}
              disabled={requestingApproval}
              className="bg-primary hover:bg-primary/90"
            >
              {requestingApproval && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
