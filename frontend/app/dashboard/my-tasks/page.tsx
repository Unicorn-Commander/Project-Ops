"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
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
import { Plus, Filter, Search, AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { iconWellClass } from "@/lib/badge-styles";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";

export default function MyTasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | "ALL">("ALL");
  const [filterPriority, setFilterPriority] = useState<TaskPriority | "ALL">("ALL");
  const [searchTerm, setSearchTerm] = useState("");
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

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const params: any = { take: 100 };
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

  const filteredTasks = tasks.filter((task) => {
    // Filter by priority
    if (filterPriority !== "ALL" && task.priority !== filterPriority) {
      return false;
    }

    // Filter by search term
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

      <div className="space-y-6">
        {/* Header — page title is in the top bar; subtitle + CTA only */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Tasks assigned to you, sorted by due date.
          </p>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New task
          </Button>
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

        {/* Filters */}
        <Card className="p-4">
          <div className="flex items-center gap-3 mb-4">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-foreground">Filters</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tasks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status Filter */}
            <Select
              value={filterStatus}
              onValueChange={(value) => setFilterStatus(value as TaskStatus | "ALL")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value={TaskStatus.PENDING}>Pending</SelectItem>
                <SelectItem value={TaskStatus.IN_PROGRESS}>In Progress</SelectItem>
                <SelectItem value={TaskStatus.WAITING_FOR_CLIENT}>Waiting for Client</SelectItem>
                <SelectItem value={TaskStatus.COMPLETED}>Completed</SelectItem>
                <SelectItem value={TaskStatus.CANCELLED}>Cancelled</SelectItem>
              </SelectContent>
            </Select>

            {/* Priority Filter */}
            <Select
              value={filterPriority}
              onValueChange={(value) => setFilterPriority(value as TaskPriority | "ALL")}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Priorities</SelectItem>
                <SelectItem value={TaskPriority.LOW}>Low</SelectItem>
                <SelectItem value={TaskPriority.MEDIUM}>Medium</SelectItem>
                <SelectItem value={TaskPriority.HIGH}>High</SelectItem>
                <SelectItem value={TaskPriority.URGENT}>Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </Card>

        {/* Tasks List */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-foreground">
              Tasks ({filteredTasks.length})
            </h2>
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              Refresh
            </Button>
          </div>

          <TaskList
            tasks={filteredTasks}
            onTaskClick={handleTaskClick}
            emptyMessage={
              searchTerm || filterStatus !== "ALL" || filterPriority !== "ALL"
                ? "No tasks match your filters"
                : "No tasks assigned to you"
            }
          />
        </Card>
      </div>
    </>
  );
}
