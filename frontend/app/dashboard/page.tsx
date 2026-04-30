"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { CreateProjectModal } from "@/components/modals/create-project-modal";
import { TaskDetailsModal } from "@/components/modals/task-details-modal";
import { EditTaskModal } from "@/components/modals/edit-task-modal";
import { TopContactsWidget } from "@/components/dashboard/top-contacts-widget";
import api from "@/lib/api";
import { getMyTasks, Task, TaskStatus } from "@/lib/tasks-api";
import { useAuthStore } from "@/lib/store";
import {
  statusBadgeClass,
  priorityTextClass,
  iconWellClass,
} from "@/lib/badge-styles";
import { format, formatDistanceToNowStrict, isPast } from "date-fns";
import {
  FileText,
  Users,
  Clock,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Plus,
  DollarSign,
  Building2,
  UserCircle,
  CheckSquare,
  ArrowRight,
} from "lucide-react";

interface DashboardStats {
  totalProjects: number;
  activeProjects: number;
  completedProjects: number;
  upcomingDeadlines: number;
}

interface RecentProject {
  id: string;
  projectNumber: string;
  title: string;
  clientName: string;
  status: string;
  priority: string;
  dueDate: string | null;
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    totalProjects: 0,
    activeProjects: 0,
    completedProjects: 0,
    upcomingDeadlines: 0,
  });
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isTaskDetailsModalOpen, setIsTaskDetailsModalOpen] = useState(false);
  const [isEditTaskModalOpen, setIsEditTaskModalOpen] = useState(false);
  const { toast } = useToast();
  const { user } = useAuthStore();

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch real dashboard data from API
      const [statsResponse, projectsResponse, tasksResponse] = await Promise.all([
        api.get("/dashboard/overview"),
        api.get("/projects?page=1&limit=5&sort=createdAt:desc"),
        getMyTasks({ take: 5, status: TaskStatus.PENDING }).catch(() => ({ data: [], total: 0, skip: 0, take: 0 })),
      ]);

      setStats({
        totalProjects: statsResponse.data.totalProjects || 0,
        activeProjects: statsResponse.data.activeProjects || 0,
        completedProjects: statsResponse.data.completedProjects || 0,
        upcomingDeadlines: statsResponse.data.upcomingDeadlines || 0,
      });

      setRecentProjects(projectsResponse.data.data || []);

      // Handle both response formats: array directly or { data: [...] }
      const tasksData = Array.isArray(tasksResponse) ? tasksResponse : (tasksResponse.data || []);
      setMyTasks(tasksData);
      setLoading(false);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      toast({
        title: "Error",
        description: "Failed to load dashboard data",
        variant: "destructive",
      });
      setLoading(false);
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
    fetchDashboardData();
  };

  // Status pill / priority text colours come from lib/badge-styles so the
  // same treatment applies everywhere and renders correctly in both themes.
  const getStatusColor = statusBadgeClass;
  const getPriorityColor = priorityTextClass;

  const formatDueDate = (iso: string) => {
    const d = new Date(iso);
    if (isPast(d)) return `overdue · ${format(d, "MMM d")}`;
    return `${formatDistanceToNowStrict(d, { addSuffix: true })} · ${format(d, "MMM d")}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/4"></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-32 bg-muted rounded-xl"></div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <CreateProjectModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={fetchDashboardData}
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

      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {user?.firstName ? `Welcome back, ${user.firstName}` : "Welcome back"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Here's what's happening across your projects today.
            </p>
          </div>
          <Button onClick={() => setIsCreateModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New project
          </Button>
        </div>

      <div>
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {([
            { label: "Total projects", value: stats.totalProjects,      icon: FileText,    tone: "primary" as const, href: "/dashboard/projects" },
            { label: "Active",         value: stats.activeProjects,     icon: Clock,       tone: "amber" as const,   href: "/dashboard/projects" },
            { label: "Completed",      value: stats.completedProjects,  icon: CheckCircle2,tone: "emerald" as const, href: "/dashboard/projects" },
            { label: "Due this week",  value: stats.upcomingDeadlines,  icon: AlertCircle, tone: "rose" as const,    href: "/dashboard/my-tasks" },
          ]).map(({ label, value, icon: Icon, tone, href }) => (
            <Card
              key={label}
              onClick={() => router.push(href)}
              className="group relative cursor-pointer overflow-hidden p-5 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">
                    {value}
                  </p>
                </div>
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition-transform group-hover:scale-105 ${iconWellClass(tone)}`}>
                  <Icon className="h-5 w-5" strokeWidth={1.75} />
                </div>
              </div>
              {/* Subtle bottom-right gradient for depth */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-border to-transparent"
              />
            </Card>
          ))}
        </div>

        {/* My Tasks + Top Contacts on top row; Recent Projects spans full width below */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* My Tasks */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <CheckSquare className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-bold text-foreground">My Tasks</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/dashboard/my-tasks")}
              >
                View All
              </Button>
            </div>

            <div className="space-y-3">
              {myTasks.length === 0 ? (
                <div className="text-center py-8">
                  <CheckSquare className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-50" />
                  <p className="text-muted-foreground">No pending tasks</p>
                </div>
              ) : (
                myTasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleTaskClick(task)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground mb-1 truncate">
                          {task.title}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-2 line-clamp-1">
                          {task.description}
                        </p>
                        {task.project && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{task.project.projectNumber}</span>
                            <span>•</span>
                            <span className="truncate">{task.project.clientName}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span className={`text-xs font-semibold ${getPriorityColor(task.priority)}`}>
                          {task.priority}
                        </span>
                        {task.dueDate && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {formatDueDate(task.dueDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {myTasks.length > 0 && (
              <Button
                variant="ghost"
                className="w-full mt-4"
                onClick={() => router.push("/dashboard/my-tasks")}
              >
                View All Tasks
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </Card>

          {/* Top Contacts Widget */}
          <TopContactsWidget />
        </div>

        {/* Recent Projects — full width below */}
        <Card className="p-6 mt-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-foreground">Recent Projects</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/dashboard/projects")}
            >
              View All
            </Button>
          </div>

          {recentProjects.length === 0 ? (
            <div className="text-center py-10">
              <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
              <p className="text-sm text-muted-foreground">No projects yet — create one to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentProjects.map((projectItem) => (
                <div
                  key={projectItem.id}
                  className="flex items-center justify-between gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/dashboard/projects/${projectItem.id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1.5">
                      <span className="font-mono text-xs text-muted-foreground">
                        {projectItem.projectNumber}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getStatusColor(
                          projectItem.status
                        )}`}
                      >
                        {projectItem.status.replace("_", " ")}
                      </span>
                    </div>
                    <h3 className="font-semibold text-foreground truncate">
                      {projectItem.title}
                    </h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {projectItem.clientName}
                    </p>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        Priority
                      </p>
                      <p className={`text-sm font-semibold ${getPriorityColor(projectItem.priority)}`}>
                        {projectItem.priority}
                      </p>
                    </div>
                    {projectItem.dueDate && (
                      <div className="text-right">
                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                          Due
                        </p>
                        <p className="text-sm font-semibold text-foreground tabular-nums">
                          {format(new Date(projectItem.dueDate), "MMM d, yyyy")}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
    </>
  );
}
