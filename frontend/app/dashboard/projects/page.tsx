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
import { useWorkspace } from "@/components/workspace-provider";
import { CreateProjectModal } from "@/components/modals/create-project-modal";
import { EditProjectModal } from "@/components/modals/edit-project-modal";
import { HelpHint } from "@/components/guidance";
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
  withinDateRange,
  DateRangePreset,
  DATE_RANGE_OPTIONS,
} from "@/lib/list-controls";
import {
  BulkActionBar,
  BulkActionButton,
} from "@/components/ui/bulk-action-bar";
import {
  Trash2 as TrashIcon,
  CheckSquare as CheckSquareIcon,
  Square as SquareIcon,
  Star as StarIcon,
} from "lucide-react";
import { useStarred, isStarred } from "@/lib/starred";
import { EmptyState } from "@/components/ui/empty-state";
import { BudgetBadge, type ProjectBudgetSummary } from "@/components/schedule/budget";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
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
  Plus,
  User,
  AlertCircle,
  Eye,
  Edit,
  Trash2,
  DollarSign,
  Search,
  FolderPlus,
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
  // Additive budget summary now included per-project in the list
  // response under `budgetSummary` (see ProjectBudgetSummary). Optional —
  // absent on older payloads; inner fields are null when no budget is set.
  budgetSummary?: ProjectBudgetSummary | null;
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

// Sort fields the backend GET /projects supports (sortBy ∈ these, with a
// separate sortDir asc|desc). Server-side now, so the list always reflects
// the full, correctly-ordered result set rather than a client re-sort of the
// fetched page.
const SORT_OPTIONS = [
  { value: "createdAt", label: "Date created" },
  { value: "title", label: "Title" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "dueDate", label: "Due date" },
];

type SortDir = "asc" | "desc";

export default function ProjectsPage() {
  const router = useRouter();
  const { activeWorkspace, isLoading: workspaceLoading } = useWorkspace();
  const workspaceCanWrite = !workspaceLoading &&
    ["OWNER", "ADMIN", "MANAGER", "MEMBER"].includes(activeWorkspace?.role ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { starred, toggle: toggleStar } = useStarred("projects");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterPriority, setFilterPriority] = useState("ALL");
  const [filterAssignee, setFilterAssignee] = useState("ALL");
  const [filterCreatedRange, setFilterCreatedRange] = useState<DateRangePreset | "ALL">("ALL");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchUserRole();
  }, []);

  // Refetch from the server whenever the server-driven controls change:
  // search (debounced by the toolbar before it reaches `searchTerm`), sort
  // field, and sort direction. The other filters (status/priority/assignee/
  // created-range) stay client-side over the returned set. `fetchProjects`
  // is intentionally not a dependency — it's recreated each render and reads
  // current state via closure; listing it would refetch on every render.
  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm, sortBy, sortDir]);

  // Cmd+K palette can deep-link to the New Project modal via ?new=1.
  // Reading window.location.search (instead of useSearchParams) avoids the
  // Next.js Suspense-boundary requirement for prerendered routes.
  useEffect(() => {
    if (typeof window === "undefined" || !workspaceCanWrite) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setCreateModalOpen(true);
      router.replace("/dashboard/projects");
    }
  }, [router, workspaceCanWrite]);

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
      // Server-side search + sort (Push B). The other narrowing controls
      // (status / priority / assignee / created-range) remain client-side
      // over this result set. `search` is the toolbar-debounced term.
      const params = new URLSearchParams({
        page: "1",
        limit: "500",
        sortBy,
        sortDir,
      });
      const q = searchTerm.trim();
      if (q) params.set("search", q);
      const response = await api.get(`/projects?${params.toString()}`);
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

  // Star/unstar with feedback (previously silent). `toggleStar` flips the
  // local set synchronously and broadcasts so every star icon updates at
  // once; we read the resulting state to word the toast, and surface an
  // error + revert if the localStorage write didn't take (quota / private
  // browsing).
  const handleToggleStar = (projectItem: Project) => {
    const wasStarred = starred.has(projectItem.id);
    toggleStar(projectItem.id);
    if (isStarred("projects", projectItem.id) === wasStarred) {
      // State didn't change → the write failed. Re-assert the prior state
      // (no-op for the user) and tell them why nothing happened.
      toast({
        title: "Couldn't update favorites",
        description:
          "We couldn't save this to your starred projects. Check that your browser allows local storage.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: wasStarred ? "Removed from starred" : "Added to starred",
      description: `${projectItem.projectNumber} · ${projectItem.title}`,
    });
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
    return workspaceCanWrite && (
      userRole === "ADMIN" ||
      userRole === "MANAGER" ||
      userRole === "STAFF"
    );
  };

  const canDeleteProject = () => {
    return workspaceCanWrite && (userRole === "ADMIN" || userRole === "MANAGER");
  };

  const canAssignProject = () => {
    return workspaceCanWrite && (userRole === "ADMIN" || userRole === "MANAGER");
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

  // Search + sort are handled server-side (see fetchProjects). The remaining
  // narrowing controls — status / priority / assignee / created-range — stay
  // client-side over the returned, already-sorted set, so we don't re-sort
  // here (that would override the server order).
  const filteredProjects = projects.filter((c) => {
    const matchesStatus = filterStatus === "ALL" || c.status === filterStatus;
    const matchesPriority = filterPriority === "ALL" || c.priority === filterPriority;
    const matchesAssignee =
      filterAssignee === "ALL" ||
      (filterAssignee === "UNASSIGNED" ? !c.assignedToId : c.assignedToId === filterAssignee);
    const matchesCreated =
      filterCreatedRange === "ALL" ||
      withinDateRange(c.createdAt, filterCreatedRange as DateRangePreset);
    return matchesStatus && matchesPriority && matchesAssignee && matchesCreated;
  });

  const dateRangeOptions: FilterOption[] = DATE_RANGE_OPTIONS.map((o) => ({
    value: o.value,
    label: o.label,
  }));

  // Any filter/search narrowing the list — drives the two-mode empty state
  // (filtered-to-nothing vs genuinely empty).
  const hasActiveFilters =
    searchTerm !== "" ||
    filterStatus !== "ALL" ||
    filterPriority !== "ALL" ||
    filterAssignee !== "ALL" ||
    filterCreatedRange !== "ALL";

  const clearAllFilters = () => {
    setSearchTerm("");
    setFilterStatus("ALL");
    setFilterPriority("ALL");
    setFilterAssignee("ALL");
    setFilterCreatedRange("ALL");
  };

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

  // Bulk delete — optimistic: pull the selected rows out of the list
  // immediately so the UI responds at once, then run N parallel
  // single-entity requests (until a backend bulk endpoint exists). The
  // follow-up fetchProjects() is the source of truth and re-adds any row
  // that failed to delete, so a partial/total failure self-reverts.
  const [bulkDeletePending, setBulkDeletePending] = useState(false);
  const runBulkDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const snapshot = projects;
    setBulkDeletePending(true);
    setProjects((prev) => prev.filter((p) => !idSet.has(p.id)));
    setSelectedIds(new Set());
    try {
      const results = await Promise.allSettled(
        ids.map((id) => api.delete(`/projects/${id}`)),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      if (failed === 0) {
        toast({
          title: "Projects deleted",
          description: `Deleted ${ok} of ${ids.length} projects`,
        });
      } else if (ok === 0) {
        toast({
          title: "Delete failed",
          description: `0 of ${ids.length} deleted. Check permissions or refresh.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Delete partial",
          description: `${ok} of ${ids.length} deleted; ${failed} failed and were restored.`,
          variant: "destructive",
        });
      }
    } catch {
      // Network-level failure before any settled result — restore.
      setProjects(snapshot);
      toast({
        title: "Delete failed",
        description: "We couldn't reach the server. Nothing was deleted.",
        variant: "destructive",
      });
    } finally {
      // Reconcile against the server (re-adds survivors, drops the rest).
      await fetchProjects();
      setBulkDeletePending(false);
    }
  };

  // Bulk status — optimistic: stamp the new status on the selected rows
  // immediately, then PATCH each. fetchProjects() reconciles; on a total
  // failure we snap back to the pre-change snapshot.
  const [bulkStatusPending, setBulkStatusPending] = useState(false);
  const runBulkStatus = async (target: string) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const snapshot = projects;
    setBulkStatusPending(true);
    setProjects((prev) =>
      prev.map((p) => (idSet.has(p.id) ? { ...p, status: target } : p)),
    );
    setSelectedIds(new Set());
    try {
      const results = await Promise.allSettled(
        ids.map((id) => api.patch(`/projects/${id}/status`, { status: target })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      if (ok === 0) {
        // Nothing took — revert the optimistic stamp.
        setProjects(snapshot);
      }
      toast({
        title: ok === ids.length ? "Status updated" : ok === 0 ? "Status update failed" : "Status update partial",
        description: `${ok} of ${ids.length} projects → ${target.replace(/_/g, " ")}`,
        variant: ok === ids.length ? "default" : "destructive",
      });
    } finally {
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
        <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
          Every project you can see, newest first.
          <HelpHint learnMore={{ category: "projects-tasks", article: "projects" }}>
            A project groups the tasks, documents, time, and billing for one
            engagement — each with an auto-assigned number and an optional client.
          </HelpHint>
        </p>
        <div className="flex items-center gap-2">
          <ExportCsvButton
            data={filteredProjects}
            filenameStem="projects"
            dateField={{ label: "Created", get: (p) => p.createdAt }}
            statusField={{
              label: "Status",
              options: STATUS_OPTIONS.filter((s) => s.value !== "ALL").map((s) => ({
                value: s.value,
                label: s.label,
              })),
              get: (p) => p.status,
            }}
            buildHeader={() => [
              "Project Number",
              "Title",
              "Client",
              "Status",
              "Priority",
              "Created",
              "Due Date",
              "Assigned To",
              "Billing Amount",
              "Amount Paid",
              "Payment Status",
            ]}
            buildRow={(p) => [
              p.projectNumber,
              p.title,
              p.clientName ?? "",
              p.status,
              p.priority,
              p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : "",
              p.dueDate ? new Date(p.dueDate).toISOString().slice(0, 10) : "",
              p.assignedTo
                ? `${p.assignedTo.firstName ?? ""} ${p.assignedTo.lastName ?? ""}`.trim() ||
                  (p.assignedTo.email ?? "")
                : "",
              p.billingAmount ?? "",
              p.amountPaid ?? "",
              p.paymentStatus ?? "",
            ]}
          />
          {workspaceCanWrite && <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Button>}
        </div>
      </div>

      {/* Stats — clickable status-filter chips. Padding + typography match
          the dashboard home stat cards (p-5, uppercase tracked label,
          tabular 3xl value) so stat surfaces read consistently app-wide. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Object.entries(statusCounts).map(([status, count]) => (
          <Card
            key={status}
            className={`p-5 cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md ${
              filterStatus === status ? "ring-2 ring-primary" : ""
            }`}
            onClick={() => setFilterStatus(status)}
          >
            <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {status.replace("_", " ")}
            </div>
            <div className="text-3xl font-semibold tracking-tight text-foreground tabular-nums mt-1.5">
              {count}
            </div>
          </Card>
        ))}
      </div>

      {/* Toolbar — search + multi-filter + sort + active-chip row.
          Status filter still lives on the stat cards above for the
          big-button glance pattern, but it's also reachable here. */}
      <ListToolbar
        search={searchTerm}
        onSearchChange={setSearchTerm}
        searchPlaceholder="Search by project number, title, or client…"
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
        sortBy={sortBy}
        sortDir={sortDir}
        sortOptions={SORT_OPTIONS}
        onSortChange={(by, dir) => {
          setSortBy(by);
          setSortDir(dir);
        }}
        views={{
          scope: "projects",
          current: {
            filterStatus,
            filterPriority,
            filterAssignee,
            filterCreatedRange,
            sortBy,
            sortDir,
          },
          onApply: (state) => {
            if (state.filterStatus !== undefined) setFilterStatus(state.filterStatus);
            if (state.filterPriority !== undefined) setFilterPriority(state.filterPriority);
            if (state.filterAssignee !== undefined) setFilterAssignee(state.filterAssignee);
            if (state.filterCreatedRange !== undefined) setFilterCreatedRange(state.filterCreatedRange as DateRangePreset);
            // Tolerate both the new split form (sortBy + sortDir) and any
            // legacy combined "field-dir" sortBy from views saved before the
            // server-side-sort switch. Fields not in SORT_OPTIONS are ignored.
            if (state.sortBy !== undefined) {
              let by = state.sortBy;
              let dir: SortDir | undefined =
                state.sortDir === "asc" || state.sortDir === "desc" ? state.sortDir : undefined;
              if (by.includes("-")) {
                const [field, d] = by.split("-");
                by = field;
                if (!dir && (d === "asc" || d === "desc")) dir = d;
              }
              if (SORT_OPTIONS.some((o) => o.value === by)) {
                setSortBy(by);
                if (dir) setSortDir(dir);
              }
            } else if (state.sortDir === "asc" || state.sortDir === "desc") {
              setSortDir(state.sortDir);
            }
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
        {canEditProject() && filteredProjects.length > 0 && (
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
            <div className="flex items-start gap-3 sm:gap-4">
              {/* Selection checkbox — clicking the row body still
                  navigates; the checkbox stops propagation. */}
              {canEditProject() && <button
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
              </button>}
              {/* Content + actions — stacked on mobile, side-by-side from
                  the sm breakpoint up so the card reads cleanly on phones. */}
              <div className="flex flex-1 min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  {/* Star — local-only favorite (v1.6.47). Surfaces in
                      the Cmd+K palette as a Starred section. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleStar(projectItem);
                    }}
                    className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted/60 transition-colors"
                    aria-label={starred.has(projectItem.id) ? "Unstar project" : "Star project"}
                    title={starred.has(projectItem.id) ? "Unstar" : "Star"}
                  >
                    <StarIcon
                      className={`h-4 w-4 ${
                        starred.has(projectItem.id)
                          ? "fill-amber-400 text-amber-500 dark:text-amber-400"
                          : "text-muted-foreground/50 hover:text-muted-foreground"
                      }`}
                      strokeWidth={1.75}
                    />
                  </button>
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

                  {/* Budget burn-down — compact pill from the additive
                      budget summary on the list response. Renders nothing
                      when no budget is set. */}
                  <BudgetBadge budget={projectItem.budgetSummary} />
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

                <div className="flex items-center gap-x-6 gap-y-2 text-sm text-muted-foreground flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <User className="h-4 w-4" />
                    <span>{projectItem.clientName}</span>
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

              <div className="flex flex-row flex-wrap gap-2 shrink-0 sm:flex-col">
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
            </div>
          </Card>
          );
        })}
      </div>

      {filteredProjects.length === 0 &&
        (hasActiveFilters ? (
          // Projects exist, but the current filters/search hide them all —
          // offer a one-click reset rather than a dead-end "create" CTA.
          <EmptyState
            icon={Search}
            iconTone="zinc"
            title="No projects match your filters"
            body="Nothing here fits the current search, status, priority, assignee, or date range. Clear them to see every project again."
            action={
              <Button variant="outline" onClick={clearAllFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          // Genuinely empty — first-run state.
          <EmptyState
            icon={FolderPlus}
            iconTone="primary"
            title="No projects yet"
            body={workspaceCanWrite ? "Create your first project to start tracking work, schedules, and budgets." : "Projects shared with you will appear here."}
            action={workspaceCanWrite ? (
              <Button onClick={() => setCreateModalOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create project
              </Button>
            ) : undefined}
          />
        ))}

      {/* Create Project Modal */}
      <CreateProjectModal
        isOpen={workspaceCanWrite && createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => {
          fetchProjects();
          setCreateModalOpen(false);
        }}
      />

      {/* Edit Project Modal */}
      <EditProjectModal
        projectData={selectedProject}
        isOpen={canEditProject() && editModalOpen}
        onClose={() => {
          setEditModalOpen(false);
          setSelectedProject(null);
        }}
        onSuccess={fetchProjects}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={canDeleteProject() && deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
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
      {canEditProject() && <BulkActionBar
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
        {canDeleteProject() && <BulkActionButton
          icon={TrashIcon}
          pending={bulkDeletePending}
          onClick={() => {
            if (
              window.confirm(
                `Delete ${selectedIds.size} project${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`,
              )
            ) {
              runBulkDelete([...selectedIds]);
            }
          }}
          destructive
        >
          Delete
        </BulkActionButton>}
      </BulkActionBar>}
    </div>
  );
}
