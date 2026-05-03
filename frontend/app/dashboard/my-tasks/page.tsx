"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { TaskList } from "@/components/tasks/task-list";
import { CreateTaskModal } from "@/components/modals/create-task-modal";
import { TaskDetailsModal } from "@/components/modals/task-details-modal";
import { EditTaskModal } from "@/components/modals/edit-task-modal";
import {
  getMyTasks,
  getOverdueTasks,
  Task,
  TaskStatus,
  TaskPriority,
} from "@/lib/tasks-api";
import { Plus, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { iconWellClass } from "@/lib/badge-styles";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
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
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Trash2 as TrashIcon, ChevronDown as ChevronDownIcon, CheckSquare as CheckSquareIcon, Square as SquareIcon } from "lucide-react";
import api from "@/lib/api";
import { ExportCsvButton } from "@/components/ui/export-csv-button";
import { useStarred } from "@/lib/starred";
import { Pin as PinIcon } from "lucide-react";

const STATUS_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All statuses" },
  { value: TaskStatus.PENDING, label: "Pending", dot: "bg-blue-500" },
  { value: TaskStatus.IN_PROGRESS, label: "In progress", dot: "bg-amber-500" },
  { value: TaskStatus.WAITING_FOR_CLIENT, label: "Waiting for client", dot: "bg-violet-500" },
  { value: TaskStatus.COMPLETED, label: "Completed", dot: "bg-emerald-500" },
  { value: TaskStatus.CANCELLED, label: "Cancelled", dot: "bg-rose-500" },
];

const PRIORITY_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All priorities" },
  { value: TaskPriority.URGENT, label: "Urgent", dot: "bg-rose-500" },
  { value: TaskPriority.HIGH, label: "High", dot: "bg-orange-500" },
  { value: TaskPriority.MEDIUM, label: "Medium", dot: "bg-amber-500" },
  { value: TaskPriority.LOW, label: "Low", dot: "bg-emerald-500" },
];

const SORT_OPTIONS = [
  { value: "dueDate-asc", label: "Due soon" },
  { value: "createdAt-desc", label: "Newest first" },
  { value: "createdAt-asc", label: "Oldest first" },
  { value: "updatedAt-desc", label: "Recently updated" },
  { value: "priority-desc", label: "Priority (highest)" },
  { value: "title-asc", label: "Title A–Z" },
];

export default function MyTasksPage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "ALL">("ALL");
  const [filterPriority, setFilterPriority] = useState<TaskPriority | "ALL">("ALL");
  const [filterProject, setFilterProject] = useState<string>("ALL");
  const [filterCreatedRange, setFilterCreatedRange] = useState<DateRangePreset | "ALL">("ALL");
  const [sortBy, setSortBy] = useState("dueDate-asc");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { starred: pinnedTaskIds, toggle: togglePinnedTask } = useStarred("tasks");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const { toast } = useToast();

  // Debug: Log current user info
  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      console.log("Current logged in user:", user);
      console.log("User ID:", user.id);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchOverdueTasks();
  }, [filterStatus]);

  // Deep-link from Cmd+K palette: ?new=1 opens the Create Task modal.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      setIsCreateModalOpen(true);
      router.replace("/dashboard/my-tasks");
    }
  }, [router]);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params: any = { take: 500 };
      if (filterStatus !== "ALL") {
        params.status = filterStatus;
      }
      console.log("Fetching my tasks with params:", params);
      const response = await getMyTasks(params);
      console.log("My tasks API response:", response);

      // Handle both response formats: array directly or { data: [...] }
      const tasksData = Array.isArray(response) ? response : (response.data || []);
      console.log("Tasks data:", tasksData);
      setTasks(tasksData);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      setTasks([]);
      toast({
        title: "Error",
        description: "Failed to load tasks",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchOverdueTasks = async () => {
    try {
      const response = await getOverdueTasks();
      // Handle both response formats: array directly or { data: [...] }
      const tasksData = Array.isArray(response) ? response : (response.data || []);
      setOverdueTasks(tasksData);
    } catch (error) {
      console.error("Error fetching overdue tasks:", error);
      setOverdueTasks([]);
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsDetailsModalOpen(true);
  };

  const handleEditClick = () => {
    setIsDetailsModalOpen(false);
    setIsEditModalOpen(true);
  };

  const handleRefresh = () => {
    fetchTasks();
    fetchOverdueTasks();
  };

  // Project filter options derived from loaded tasks (no extra round-trip).
  const projectOptions: FilterOption[] = (() => {
    const seen = new Map<string, string>();
    tasks.forEach((t) => {
      if (t.project?.id) {
        const label = t.project.projectNumber
          ? `${t.project.projectNumber} — ${t.project.title ?? ""}`.trim()
          : (t.project.title ?? t.project.id.slice(0, 8));
        seen.set(t.project.id, label);
      }
    });
    return [
      { value: "ALL", label: "All projects" },
      ...Array.from(seen.entries()).map(([value, label]) => ({ value, label })),
    ];
  })();

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

  // Bulk delete + bulk status — N parallel single requests until backend
  // bulk endpoints land.
  const bulkDelete = useBulkRunner({
    op: (id: string) => api.delete(`/tasks/${id}`),
    label: "Deleted",
    successMessage: (ok, total) => `Deleted ${ok} of ${total} tasks`,
    onAfter: async () => {
      setSelectedIds(new Set());
      handleRefresh();
    },
  });
  const [bulkStatusPending, setBulkStatusPending] = useState(false);
  const runBulkStatus = async (target: TaskStatus) => {
    const ids = [...selectedIds];
    setBulkStatusPending(true);
    try {
      const results = await Promise.allSettled(
        ids.map((id) => api.patch(`/tasks/${id}/status`, { status: target })),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      toast({
        title: ok === ids.length ? "Status updated" : "Status update partial",
        description: `${ok} of ${ids.length} tasks → ${target.replace(/_/g, " ").toLowerCase()}`,
        variant: ok === ids.length ? "default" : "destructive",
      });
    } finally {
      setSelectedIds(new Set());
      handleRefresh();
      setBulkStatusPending(false);
    }
  };

  const filteredTasks = tasks
    .filter((task) => {
      if (filterPriority !== "ALL" && task.priority !== filterPriority) return false;
      if (filterProject !== "ALL" && task.project?.id !== filterProject) return false;
      if (
        filterCreatedRange !== "ALL" &&
        !withinDateRange((task as any).createdAt, filterCreatedRange as DateRangePreset)
      ) {
        return false;
      }
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        return (
          task.title?.toLowerCase().includes(search) ||
          task.description?.toLowerCase().includes(search) ||
          task.project?.projectNumber?.toLowerCase().includes(search) ||
          task.project?.clientName?.toLowerCase().includes(search)
        );
      }
      return true;
    })
    .sort((a, b) => {
      const [field, dir] = sortBy.split("-") as [string, "asc" | "desc"];
      if (field === "priority") return (priorityRank(b.priority) - priorityRank(a.priority)) * (dir === "desc" ? 1 : -1);
      const av = (a as any)[field];
      const bv = (b as any)[field];
      return compareValues(av, bv, dir);
    });

  const taskCounts = {
    all: tasks.length,
    pending: tasks.filter((t) => t.status === TaskStatus.PENDING).length,
    inProgress: tasks.filter((t) => t.status === TaskStatus.IN_PROGRESS).length,
    waitingForClient: tasks.filter((t) => t.status === TaskStatus.WAITING_FOR_CLIENT).length,
    completed: tasks.filter((t) => t.status === TaskStatus.COMPLETED).length,
    overdue: overdueTasks.length,
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-10" />
                </div>
                <Skeleton className="h-10 w-10 rounded-lg" />
              </div>
            </Card>
          ))}
        </div>
        <Card className="p-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          {[1, 2, 3].map((i) => (
            <SkeletonText key={i} lines={2} />
          ))}
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* Modals */}
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={handleRefresh}
      />

      <TaskDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => {
          setIsDetailsModalOpen(false);
          setSelectedTask(null);
        }}
        task={selectedTask}
        onEdit={handleEditClick}
        onUpdate={handleRefresh}
      />

      <EditTaskModal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setSelectedTask(null);
        }}
        onSuccess={() => {
          handleRefresh();
          setSelectedTask(null);
        }}
        task={selectedTask}
      />

      <div className="po-page-enter space-y-6">
        {/* Header — page title is in the top bar; subtitle + CTA only */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Tasks assigned to you, sorted by due date.
          </p>
          <div className="flex items-center gap-2">
            <ExportCsvButton
              data={filteredTasks}
              filenameStem="my-tasks"
              dateField={{ label: "Due", get: (t) => t.dueDate ?? null }}
              statusField={{
                label: "Status",
                options: STATUS_OPTIONS.filter((s) => s.value !== "ALL").map((s) => ({
                  value: s.value as string,
                  label: s.label,
                })),
                get: (t) => t.status,
              }}
              buildHeader={() => ["Title", "Project", "Status", "Priority", "Type", "Due Date", "Created"]}
              buildRow={(t) => [
                t.title,
                t.project?.projectNumber ?? "",
                t.status,
                t.priority,
                t.type ?? "",
                t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : "",
                (t as any).createdAt ? new Date((t as any).createdAt).toISOString().slice(0, 10) : "",
              ]}
            />
            <Button onClick={() => setIsCreateModalOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New task
            </Button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Pending */}
          <Card className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Pending</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {taskCounts.pending}
                </p>
              </div>
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconWellClass("blue")}`}>
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {/* In Progress */}
          <Card className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">In Progress</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {taskCounts.inProgress}
                </p>
              </div>
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconWellClass("amber")}`}>
                <Clock className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {/* Completed */}
          <Card className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Completed</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {taskCounts.completed}
                </p>
              </div>
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconWellClass("emerald")}`}>
                <CheckCircle className="h-5 w-5" />
              </div>
            </div>
          </Card>

          {/* Overdue */}
          <Card className="p-4 hover:shadow-md transition-shadow border-rose-500/40 dark:border-rose-500/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Overdue</p>
                <p className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {taskCounts.overdue}
                </p>
              </div>
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${iconWellClass("rose")}`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
          </Card>
        </div>

        {/* Overdue Tasks Alert */}
        {overdueTasks.length > 0 && (
          <Card className="p-4 bg-rose-500/10 border-rose-500/40 dark:border-rose-500/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-rose-600 dark:text-rose-400 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-rose-700 dark:text-rose-200">
                  You have {overdueTasks.length} overdue task{overdueTasks.length !== 1 ? 's' : ''}
                </h3>
                <p className="text-sm text-rose-700/80 dark:text-rose-300/80 mt-1">
                  These tasks are past their due date and require immediate attention.
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Toolbar — search + multi-filter + sort + active-chip row (v1.6.32). */}
        <ListToolbar
          search={{
            value: searchTerm,
            onChange: setSearchTerm,
            placeholder: "Search tasks…",
          }}
          filters={[
            {
              key: "status",
              label: "Status",
              value: filterStatus,
              onChange: (v) => setFilterStatus(v as TaskStatus | "ALL"),
              options: STATUS_OPTIONS,
            },
            {
              key: "priority",
              label: "Priority",
              value: filterPriority,
              onChange: (v) => setFilterPriority(v as TaskPriority | "ALL"),
              options: PRIORITY_OPTIONS,
            },
            {
              key: "project",
              label: "Project",
              value: filterProject,
              onChange: setFilterProject,
              options: projectOptions,
              hidden: projectOptions.length <= 1,
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
            scope: "tasks",
            current: {
              filterStatus,
              filterPriority,
              filterProject,
              filterCreatedRange,
              sortBy,
            },
            onApply: (state) => {
              if (state.filterStatus !== undefined) setFilterStatus(state.filterStatus as TaskStatus | "ALL");
              if (state.filterPriority !== undefined) setFilterPriority(state.filterPriority as TaskPriority | "ALL");
              if (state.filterProject !== undefined) setFilterProject(state.filterProject);
              if (state.filterCreatedRange !== undefined) setFilterCreatedRange(state.filterCreatedRange as DateRangePreset);
              if (state.sortBy !== undefined) setSortBy(state.sortBy);
            },
          }}
        />

        <p className="text-xs text-muted-foreground">
          {filteredTasks.length === tasks.length
            ? `${tasks.length} task${tasks.length === 1 ? "" : "s"}`
            : `${filteredTasks.length} of ${tasks.length} tasks match`}
        </p>

        {/* Pinned tasks (v1.6.54) — float to the top, local-only,
            persisted in localStorage scope "tasks". Surfaces only when
            at least one pinned task is present in the current
            filter set. */}
        {(() => {
          const pinned = filteredTasks.filter((t) => pinnedTaskIds.has(t.id));
          const rest = filteredTasks.filter((t) => !pinnedTaskIds.has(t.id));
          return (
            <>
              {pinned.length > 0 && (
                <Card className="p-6 border-l-4 border-l-amber-400/70">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-foreground inline-flex items-center gap-2">
                      <PinIcon className="h-5 w-5 fill-amber-400 text-amber-500" strokeWidth={1.75} />
                      Pinned ({pinned.length})
                    </h2>
                  </div>
                  <TaskList
                    tasks={pinned}
                    onTaskClick={handleTaskClick}
                    onTaskChange={handleRefresh}
                    selectedIds={selectedIds}
                    onToggleSelect={toggleSelected}
                    pinnedIds={pinnedTaskIds}
                    onTogglePin={togglePinnedTask}
                  />
                </Card>
              )}
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold text-foreground">
                    Tasks ({rest.length})
                  </h2>
                  <Button variant="outline" size="sm" onClick={handleRefresh}>
                    Refresh
                  </Button>
                </div>

                <TaskList
                  tasks={rest}
                  onTaskClick={handleTaskClick}
                  onTaskChange={handleRefresh}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelected}
                  pinnedIds={pinnedTaskIds}
                  onTogglePin={togglePinnedTask}
                  emptyMessage={
                    searchTerm || filterStatus !== "ALL" || filterPriority !== "ALL"
                      ? "No tasks match your filters"
                      : "No tasks assigned to you"
                  }
                />
              </Card>
            </>
          );
        })()}
      </div>

      {/* Bulk-action bar (v1.6.40) */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        entityLabel="task"
        onClear={() => setSelectedIds(new Set())}
      >
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
            {Object.values(TaskStatus).map((s) => (
              <DropdownMenuItem
                key={s}
                onSelect={() => runBulkStatus(s)}
                className="cursor-pointer"
              >
                {s.replace(/_/g, " ").toLowerCase()}
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
                `Delete ${selectedIds.size} task${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`,
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
    </>
  );
}
