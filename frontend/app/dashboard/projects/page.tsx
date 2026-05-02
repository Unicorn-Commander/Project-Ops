"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
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
import { projectColorClasses } from "@/lib/project-colors";
import { ListToolbar, FilterOption } from "@/components/ui/list-toolbar";
import {
  compareValues,
  priorityRank,
  withinDateRange,
  DateRangePreset,
  DATE_RANGE_OPTIONS,
} from "@/lib/list-controls";
import {
  BulkActionBar,
  BulkActionButton,
  useBulkRunner,
} from "@/components/ui/bulk-action-bar";
import {
  Trash2 as TrashIcon,
  CheckSquare as CheckSquareIcon,
  Square as SquareIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { ChevronDown as ChevronDownIcon } from "lucide-react";
import { format } from "date-fns";
import {
  FileText,
  Plus,
  Calendar,
  User,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  DollarSign,
} from "lucide-react";

interface ProjectUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

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
  assignedTo?: ProjectUser | null;
  createdAt: string;
  updatedAt?: string;
  invoiceNumber?: string | null;
  billingAmount?: number | null;
  amountPaid?: number | null;
  paymentStatus?: string | null;
}

const STATUS_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All statuses" },
  { value: "NEW", label: "New", dot: "bg-blue-500" },
  { value: "IN_PROGRESS", label: "In progress", dot: "bg-amber-500" },
  { value: "UNDER_REVIEW", label: "Under review", dot: "bg-violet-500" },
  { value: "COMPLETED", label: "Completed", dot: "bg-emerald-500" },
  { value: "ON_HOLD", label: "On hold", dot: "bg-zinc-500" },
  { value: "CANCELLED", label: "Cancelled", dot: "bg-rose-500" },
];

const PRIORITY_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All priorities" },
  { value: "URGENT", label: "Urgent", dot: "bg-rose-500" },
  { value: "HIGH", label: "High", dot: "bg-orange-500" },
  { value: "MEDIUM", label: "Medium", dot: "bg-amber-500" },
  { value: "LOW", label: "Low", dot: "bg-emerald-500" },
];

const SORT_OPTIONS = [
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "updatedAt-desc", label: "Recently updated" },
  { value: "dueDate-asc", label: "Due soon" },
  { value: "priority-desc", label: "Priority (highest)" },
  { value: "title-asc", label: "Title A–Z" },
  { value: "projectNumber-asc", label: "Project number" },
];

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterPriority, setFilterPriority] = useState("ALL");
  const [filterAssignee, setFilterAssignee] = useState("ALL");
  const [filterCreatedRange, setFilterCreatedRange] = useState<DateRangePreset | "ALL">("ALL");
  const [sortBy, setSortBy] = useState("createdAt-desc");
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

  // Cmd+K palette can deep-link to the New Project modal via ?new=1.
  // Reading window.location.search (instead of useSearchParams) avoids the
  // Next.js Suspense-boundary requirement for prerendered routes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setCreateModalOpen(true);
      router.replace("/dashboard/projects");
    }
  }, [router]);

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
      const response = await api.get("/projects?page=1&limit=500");
      setProjects(response.data.data || []);
      setTotalAvailable(response.data.meta?.total ?? response.data.data?.length ?? 0);
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

  // Build the assignee filter options from whatever's actually present on
  // the loaded projects — keeps the dropdown narrow + meaningful without
  // a separate /users round-trip.
  const assigneeOptions: FilterOption[] = (() => {
    const seen = new Map<string, string>();
    seen.set("UNASSIGNED", "Unassigned");
    projects.forEach((p) => {
      if (p.assignedTo && p.assignedTo.id) {
        const name = p.assignedTo.firstName && p.assignedTo.lastName
          ? `${p.assignedTo.firstName} ${p.assignedTo.lastName}`
          : (p.assignedTo.email ?? p.assignedTo.id);
        seen.set(p.assignedTo.id, name);
      } else if (p.assignedToId) {
        seen.set(p.assignedToId, p.assignedToId.slice(0, 8));
      }
    });
    return [
      { value: "ALL", label: "Any assignee" },
      ...Array.from(seen.entries()).map(([value, label]) => ({ value, label })),
    ];
  })();

  const filteredProjects = projects
    .filter((c) => {
      const matchesSearch =
        searchTerm === "" ||
        c.projectNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.clientName ?? "").toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = filterStatus === "ALL" || c.status === filterStatus;
      const matchesPriority = filterPriority === "ALL" || c.priority === filterPriority;
      const matchesAssignee =
        filterAssignee === "ALL" ||
        (filterAssignee === "UNASSIGNED" ? !c.assignedToId : c.assignedToId === filterAssignee);
      const matchesCreated =
        filterCreatedRange === "ALL" ||
        withinDateRange(c.createdAt, filterCreatedRange as DateRangePreset);
      return matchesSearch && matchesStatus && matchesPriority && matchesAssignee && matchesCreated;
    })
    .sort((a, b) => {
      const [field, dir] = sortBy.split("-") as [string, "asc" | "desc"];
      if (field === "priority") return (priorityRank(b.priority) - priorityRank(a.priority)) * (dir === "desc" ? 1 : -1);
      const av = (a as any)[field];
      const bv = (b as any)[field];
      return compareValues(av, bv, dir);
    });

  const dateRangeOptions: FilterOption[] = DATE_RANGE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  // Selection helpers (v1.6.40 bulk actions).
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allFilteredSelected =
    filteredProjects.length > 0 &&
    filteredProjects.every((p) => selectedIds.has(p.id));
  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      if (allFilteredSelected) return new Set();
      const next = new Set(prev);
      filteredProjects.forEach((p) => next.add(p.id));
      return next;
    });
  };

  // Bulk delete — N parallel single-entity requests until a backend
  // bulk endpoint exists. Toasts aggregate the result.
  const bulkDelete = useBulkRunner({
    op: (id: string) => api.delete(`/projects/${id}`),
    label: "Deleted",
    successMessage: (ok, total) => `Deleted ${ok} of ${total} projects`,
    onAfter: async () => {
      setSelectedIds(new Set());
      await fetchProjects();
    },
  });
  const [bulkStatusPending, setBulkStatusPending] = useState(false);
  const runBulkStatus = async (target: string) => {
    const ids = [...selectedIds];
    setBulkStatusPending(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => api.patch(`/projects/${id}/status`, { status: target })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      toast({
        title: ok === ids.length ? "Status updated" : "Status update partial",
        description: `${ok} of ${ids.length} projects → ${target.replace(/_/g, " ")}`,
        variant: ok === ids.length ? "default" : "destructive",
      });
    } finally {
      setSelectedIds(new Set());
      await fetchProjects();
      setBulkStatusPending(false);
    }
  };

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
        <Skeleton className="h-4 w-64" />
        <Card className="p-4">
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-10 flex-1 min-w-[200px]" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-40" />
          </div>
        </Card>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
              <SkeletonText lines={2} />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="po-page-enter space-y-6">
      {/* Header — title lives in the top bar; this is just the action row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Every project you can see, newest first.
        </p>
        <Button onClick={() => setCreateModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New project
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

      {/* Toolbar — search + multi-filter + sort + active-chip row.
          Status filter still lives on the stat cards above for the
          big-button glance pattern, but it's also reachable here. */}
      <ListToolbar
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: "Search by project number, title, or client…",
        }}
        filters={[
          {
            key: "status",
            label: "Status",
            value: filterStatus,
            onChange: setFilterStatus,
            options: STATUS_OPTIONS,
          },
          {
            key: "priority",
            label: "Priority",
            value: filterPriority,
            onChange: setFilterPriority,
            options: PRIORITY_OPTIONS,
          },
          {
            key: "assignee",
            label: "Assignee",
            value: filterAssignee,
            onChange: setFilterAssignee,
            options: assigneeOptions,
            hidden: assigneeOptions.length <= 2, // just "Any" + "Unassigned"
          },
          {
            key: "createdRange",
            label: "Created",
            value: filterCreatedRange,
            onChange: (v) => setFilterCreatedRange(v as DateRangePreset),
            options: dateRangeOptions,
          },
        ]}
        sort={{
          value: sortBy,
          onChange: setSortBy,
          options: SORT_OPTIONS,
        }}
        views={{
          scope: "projects",
          current: {
            filterStatus,
            filterPriority,
            filterAssignee,
            filterCreatedRange,
            sortBy,
          },
          onApply: (state) => {
            if (state.filterStatus !== undefined) setFilterStatus(state.filterStatus);
            if (state.filterPriority !== undefined) setFilterPriority(state.filterPriority);
            if (state.filterAssignee !== undefined) setFilterAssignee(state.filterAssignee);
            if (state.filterCreatedRange !== undefined) setFilterCreatedRange(state.filterCreatedRange as DateRangePreset);
            if (state.sortBy !== undefined) setSortBy(state.sortBy);
          },
        }}
      />

      {/* Result count line + select-all toggle. */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {filteredProjects.length === projects.length
            ? `${projects.length} project${projects.length === 1 ? "" : "s"}`
            : `${filteredProjects.length} of ${projects.length} projects match`}
          {totalAvailable > projects.length && (
            <span className="ml-2 text-amber-600 dark:text-amber-400">
              · Showing first {projects.length} of {totalAvailable}. Refine filters to narrow further.
            </span>
          )}
        </p>
        {filteredProjects.length > 0 && (
          <button
            type="button"
            onClick={toggleSelectAllFiltered}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {allFilteredSelected ? (
              <CheckSquareIcon className="h-3.5 w-3.5 text-primary" />
            ) : (
              <SquareIcon className="h-3.5 w-3.5" />
            )}
            {allFilteredSelected ? "Deselect all" : "Select all in view"}
          </button>
        )}
      </div>

      {/* Projects Grid */}
      <div className="grid gap-4">
        {filteredProjects.map((projectItem) => {
          const pc = projectColorClasses(projectItem.id);
          const isSelected = selectedIds.has(projectItem.id);
          return (
          <Card
            key={projectItem.id}
            className={`p-6 hover:shadow-md transition-all border-l-4 ${pc.borderLeft} ${pc.cardWash} ${isSelected ? "ring-2 ring-primary/60 ring-offset-1 ring-offset-background" : ""}`}
          >
            <div className="flex items-start justify-between gap-4">
              {/* Selection checkbox — clicking the row body still
                  navigates; the checkbox stops propagation. */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSelected(projectItem.id);
                }}
                className="mt-1 shrink-0 h-5 w-5 rounded border border-border hover:border-primary inline-flex items-center justify-center transition-colors"
                aria-label={isSelected ? "Deselect project" : "Select project"}
              >
                {isSelected && (
                  <CheckSquareIcon className="h-4 w-4 text-primary" strokeWidth={2.5} />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-xs font-medium ${pc.badgeBg} ${pc.badgeText}`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${pc.dot}`} />
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
          );
        })}
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

      {/* Bulk-action bar — shows when ≥1 project is selected (v1.6.40). */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        entityLabel="project"
        onClear={() => setSelectedIds(new Set())}
      >
        {/* Bulk status — pick from the same status options as the
            single-row StatusUpdate */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs" disabled={bulkStatusPending}>
              {bulkStatusPending ? "Updating…" : "Set status"}
              <ChevronDownIcon className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 py-1.5">
              Move to status
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {STATUS_OPTIONS.filter((s) => s.value !== "ALL").map((opt) => (
              <DropdownMenuItem
                key={opt.value}
                onSelect={() => runBulkStatus(opt.value)}
                className="cursor-pointer"
              >
                {opt.dot && (
                  <span className={`mr-2 inline-block h-2 w-2 rounded-full ${opt.dot}`} />
                )}
                {opt.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <BulkActionButton
          icon={TrashIcon}
          pending={bulkDelete.pending}
          onClick={() => {
            if (
              window.confirm(
                `Delete ${selectedIds.size} project${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`,
              )
            ) {
              bulkDelete.run([...selectedIds]);
            }
          }}
          destructive
        >
          Delete
        </BulkActionButton>
      </BulkActionBar>
    </div>
  );
}
