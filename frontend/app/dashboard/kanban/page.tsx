'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from '@dnd-kit/core';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { priorityBadgeClass } from '@/lib/badge-styles';
import {
  Task,
  TaskStatus,
  TaskPriority,
  TaskType,
  getTasks,
  updateTaskStatus,
} from '@/lib/tasks-api';
import {
  Loader2,
  Plus,
  X,
  FileText,
  Calendar,
  User,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { TASK_TYPES, taskTypeIcon } from '@/lib/task-types';
import type { Organization } from '@/lib/organizations-api';
import { projectColorClasses } from '@/lib/project-colors';
import { TaskDetailsModal } from '@/components/modals/task-details-modal';
import { CreateTaskModal } from '@/components/modals/create-task-modal';
import { EditTaskModal } from '@/components/modals/edit-task-modal';
import api from '@/lib/api';

// Interfaces — Organization comes from lib/organizations-api, Task from
// lib/tasks-api. Kept the locally-declared UserItem shape since the kanban
// only needs a subset of the User model.

interface UserItem {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
}

// Column configuration for task statuses
const columns = [
  { id: TaskStatus.PENDING, title: 'Pending', color: 'blue' },
  { id: TaskStatus.IN_PROGRESS, title: 'In Progress', color: 'yellow' },
  { id: TaskStatus.WAITING_FOR_CLIENT, title: 'Waiting for Client', color: 'purple' },
  { id: TaskStatus.COMPLETED, title: 'Completed', color: 'green' },
];

// Task type icons + labels — single source of truth in lib/task-types.tsx
const getTypeIcon = (type: TaskType) => taskTypeIcon(type);

// Priority colors mapping (dark-mode-aware via shared helper)
const getPriorityColor = (priority: TaskPriority) =>
  priorityBadgeClass(priority);

// Status column accents — subtle tinted top border + faint background tint
// so columns are visually distinct without being garish in either theme.
const statusColors: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]:            'bg-blue-500/5    border-blue-500/30',
  [TaskStatus.IN_PROGRESS]:        'bg-amber-500/5   border-amber-500/30',
  [TaskStatus.WAITING_FOR_CLIENT]: 'bg-violet-500/5  border-violet-500/30',
  [TaskStatus.COMPLETED]:          'bg-emerald-500/5 border-emerald-500/30',
  [TaskStatus.CANCELLED]:          'bg-zinc-500/5    border-zinc-500/30',
};

// Status header text colour — dark-mode-aware tints matched to the column accents.
const statusTextColors: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]:            'text-blue-700    dark:text-blue-300',
  [TaskStatus.IN_PROGRESS]:        'text-amber-700   dark:text-amber-300',
  [TaskStatus.WAITING_FOR_CLIENT]: 'text-violet-700  dark:text-violet-300',
  [TaskStatus.COMPLETED]:          'text-emerald-700 dark:text-emerald-300',
  [TaskStatus.CANCELLED]:          'text-zinc-700    dark:text-zinc-300',
};

// Task Card Component
interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  onClick: () => void;
}

function TaskCard({ task, isDragging, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging: isDraggingState,
  } = useDraggable({ id: task.id });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging || isDraggingState ? 0.5 : 1,
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== TaskStatus.COMPLETED;

  const formatDueDate = (date: string) => {
    const dueDate = new Date(date);
    const today = new Date();
    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0)  return { text: `${Math.abs(diffDays)}d overdue`, color: 'text-rose-600 dark:text-rose-400' };
    if (diffDays === 0) return { text: 'Due today',                       color: 'text-amber-600 dark:text-amber-400' };
    if (diffDays <= 3) return { text: `${diffDays}d left`,                color: 'text-amber-600 dark:text-amber-400' };
    return { text: `${diffDays}d left`, color: 'text-muted-foreground' };
  };

  const dueInfo = task.dueDate ? formatDueDate(task.dueDate) : null;

  const getInitials = (firstName: string | null, lastName: string | null, email: string) => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
  };

  // Per-project colour stripe — same project always shows the same hue
  // (deterministic by project id). Overdue rose stripe still wins so the
  // "you should look at this" signal stays loud.
  const projectColor = projectColorClasses(task.projectId);

  return (
    <div ref={setNodeRef} style={style} className="mb-2">
      <Card
        className={`p-3 transition-all hover:shadow-md cursor-pointer border-l-4 ${
          isOverdue ? 'border-l-rose-500' : projectColor.borderLeft
        } ${
          isDragging || isDraggingState ? 'shadow-lg opacity-80' : ''
        }`}
      >
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing select-none">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="text-primary">{getTypeIcon(task.type)}</div>
              <h4 className="font-semibold text-sm text-foreground line-clamp-2">{task.title}</h4>
            </div>
            <Badge className={`text-xs ${getPriorityColor(task.priority)}`}>
              {task.priority}
            </Badge>
          </div>

          <div className="text-xs text-muted-foreground mb-2">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] ${projectColor.badgeBg} ${projectColor.badgeText}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${projectColor.dot}`} />
                {task.project?.projectNumber}
              </span>
              <span className="truncate">{task.project?.title}</span>
            </div>
          </div>

          {isOverdue && (
            <div className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400 font-semibold mb-2">
              <AlertTriangle className="h-3 w-3" />
              <span>OVERDUE</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            {dueInfo && (
              <div className="flex items-center gap-1">
                <Calendar className={`h-3 w-3 ${dueInfo.color}`} />
                <span className={`text-xs ${dueInfo.color}`}>{dueInfo.text}</span>
              </div>
            )}

            {task.assignedTo ? (
              <Avatar
                name={`${task.assignedTo.firstName ?? ''} ${task.assignedTo.lastName ?? ''}`.trim() || task.assignedTo.email}
                initials={getInitials(task.assignedTo.firstName, task.assignedTo.lastName, task.assignedTo.email)}
                size={24}
              />
            ) : (
              <span className="text-xs text-muted-foreground/70">Unassigned</span>
            )}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className="mt-2 text-xs text-primary hover:underline w-full text-right"
        >
          View Details →
        </button>
      </Card>
    </div>
  );
}

// Kanban Column Component
interface KanbanColumnProps {
  id: TaskStatus;
  title: string;
  tasks: Task[];
  onTaskClick: (task: Task) => void;
}

function KanbanColumn({ id, title, tasks, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div className="flex-shrink-0 w-80">
      <div className={`rounded-t-lg p-3 border-b-2 ${statusColors[id]}`}>
        <div className="flex items-center justify-between">
          <h3 className={`font-semibold ${statusTextColors[id]}`}>{title}</h3>
          <span className={`text-sm font-medium px-2 py-1 rounded-full ${statusColors[id]}`}>
            {tasks.length}
          </span>
        </div>
      </div>

      <div
        ref={setNodeRef}
        className={`p-3 min-h-[calc(100vh-380px)] max-h-[calc(100vh-380px)] overflow-y-auto rounded-b-lg border-2 border-t-0 transition-colors ${
          isOver
            ? 'border-foreground/30 border-dashed bg-foreground/[0.04]'
            : `${statusColors[id].split(' ')[1]} bg-card`
        }`}
      >
        {tasks.length === 0 ? (
          <div
            className={`flex h-32 flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed transition-colors ${
              isOver
                ? 'border-foreground/40 text-foreground'
                : 'border-border/50 text-muted-foreground/60'
            }`}
          >
            <span className="text-[11px] uppercase tracking-wider">
              {isOver ? `Drop into ${title}` : 'Drop tasks here'}
            </span>
          </div>
        ) : (
          tasks.map((task) => <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />)
        )}
      </div>
    </div>
  );
}

// Main Kanban Page Component
export default function KanbanPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const { toast } = useToast();

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
  const [selectedOrgId, setSelectedOrgId] = useState<string>('ALL');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('ALL');
  const [selectedPriority, setSelectedPriority] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');

  // Filter data
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [projects, setProjects] = useState<any[]>([]); // Using any for projects since structure varies
  const [users, setUsers] = useState<UserItem[]>([]);

  // Modal states
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    setMounted(true);
    fetchTasks();
    fetchFilterData();
  }, []);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const response = await getTasks();
      setTasks(response.data || []);
    } catch (error) {
      // Error handling - always show errors
      setTasks([]);
      toast({
        title: 'Error',
        description: 'Failed to load tasks',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchFilterData = async () => {
    try {
      // Fetch organizations (the post-Project-Ops replacement for the old
      // /clients endpoint, which 404s post-rebrand).
      const orgsResponse = await api.get('/organizations', { params: { page: 1, limit: 1000 } });
      setOrganizations(orgsResponse.data.data || orgsResponse.data || []);

      // Fetch projects
      const projectsResponse = await api.get('/projects', { params: { page: 1, limit: 1000 } });
      setProjects(projectsResponse.data.projects || projectsResponse.data.data || projectsResponse.data || []);

      // Fetch users
      const usersResponse = await api.get('/users', { params: { page: 1, limit: 1000 } });
      setUsers(usersResponse.data.data || usersResponse.data || []);
    } catch (error) {
      // Error handling - reset data on error
      setOrganizations([]);
      setProjects([]);
      setUsers([]);
    }
  };

  // Debounced search (implemented client-side)
  const filteredTasks = useMemo(() => {
    if (!tasks || tasks.length === 0) return [];

    let filtered = tasks.filter((task) => task.status !== TaskStatus.CANCELLED);

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (task) =>
          task.title?.toLowerCase().includes(query) ||
          task.description?.toLowerCase().includes(query) ||
          task.project?.projectNumber?.toLowerCase().includes(query) ||
          task.project?.clientName?.toLowerCase().includes(query)
      );
    }

    // Organization filter — match the project's organizationId. Falls back
    // to clientName comparison when a project is filed under a free-text
    // client and we know the organization name.
    if (selectedOrgId && selectedOrgId !== 'ALL') {
      const orgName = organizations.find((o) => o.id === selectedOrgId)?.name?.toLowerCase();
      filtered = filtered.filter((task) => {
        const projectOrgId = (task.project as any)?.organizationId;
        if (projectOrgId === selectedOrgId) return true;
        if (orgName) {
          return task.project?.clientName?.toLowerCase() === orgName;
        }
        return false;
      });
    }

    // Project filter
    if (selectedProjectId && selectedProjectId !== 'ALL') {
      filtered = filtered.filter((task) => task.projectId === selectedProjectId);
    }

    // Assignee filter
    if (selectedAssigneeId && selectedAssigneeId !== 'ALL') {
      if (selectedAssigneeId === 'MY_TASKS') {
        const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
        filtered = filtered.filter((task) => task.assignedToId === userId);
      } else if (selectedAssigneeId === 'UNASSIGNED') {
        filtered = filtered.filter((task) => !task.assignedToId);
      } else {
        filtered = filtered.filter((task) => task.assignedToId === selectedAssigneeId);
      }
    }

    // Priority filter
    if (selectedPriority && selectedPriority !== 'ALL') {
      filtered = filtered.filter((task) => task.priority === selectedPriority);
    }

    // Type filter
    if (selectedType && selectedType !== 'ALL') {
      filtered = filtered.filter((task) => task.type === selectedType);
    }

    return filtered;
  }, [tasks, searchQuery, selectedOrgId, selectedProjectId, selectedAssigneeId, selectedPriority, selectedType]);

  const getTasksByStatus = (status: TaskStatus) => {
    return filteredTasks.filter((task) => task.status === status);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const taskId = active.id as string;
    const newStatus = over.id as TaskStatus;

    const currentTask = tasks.find((t) => t.id === taskId);
    if (!currentTask || currentTask.status === newStatus) return;

    // Optimistic update
    setTasks((prevTasks) =>
      prevTasks.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t))
    );

    try {
      await updateTaskStatus(taskId, newStatus);
      toast({
        title: 'Success',
        description: 'Task status updated',
      });
    } catch (error: any) {
      // Error handling - always show errors
      toast({
        title: 'Error',
        description: error.response?.data?.message || 'Failed to update task status',
        variant: 'destructive',
      });
      // Revert optimistic update
      fetchTasks();
    }
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
    setIsDetailsModalOpen(true);
  };

  const handleEditTask = () => {
    setIsDetailsModalOpen(false);
    setIsEditModalOpen(true);
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedOrgId('ALL');
    setSelectedProjectId('ALL');
    setSelectedAssigneeId('ALL');
    setSelectedPriority('ALL');
    setSelectedType('ALL');
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  if (!mounted || loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-64" />
        <Card className="p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((col) => (
            <div key={col} className="space-y-3">
              <Skeleton className="h-9" />
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Card key={i} className="p-3 space-y-2">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-24" />
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="po-page-enter space-y-6">
      {/* Header — title lives in the top bar; just the action row + hint */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Drag and drop tasks to update their status.
        </p>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New task
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          {/* Search */}
          <div className="lg:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground/70" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Organization Filter (replaces the old /clients-backed dropdown) */}
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger>
              <SelectValue placeholder="All Organizations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Organizations</SelectItem>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>
                  {org.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Project Filter */}
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger>
              <SelectValue placeholder="All Projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Projects</SelectItem>
              {projects.map((projectItem) => (
                <SelectItem key={projectItem.id} value={projectItem.id}>
                  {projectItem.projectNumber} - {projectItem.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Assignee Filter */}
          <Select value={selectedAssigneeId} onValueChange={setSelectedAssigneeId}>
            <SelectTrigger>
              <SelectValue placeholder="All Assignees" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Assignees</SelectItem>
              <SelectItem value="MY_TASKS">My Tasks</SelectItem>
              <SelectItem value="UNASSIGNED">Unassigned</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.firstName && user.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Priority Filter */}
          <Select value={selectedPriority} onValueChange={setSelectedPriority}>
            <SelectTrigger>
              <SelectValue placeholder="All Priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Priorities</SelectItem>
              {Object.values(TaskPriority).map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div className="flex items-center gap-4">
            {/* Type Filter — labels via shared TASK_TYPES helper */}
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {TASK_TYPES.map((meta) => (
                  <SelectItem key={meta.value} value={meta.value}>
                    {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="text-sm text-muted-foreground">
              Showing {filteredTasks.length} of {tasks.filter((t) => t.status !== TaskStatus.CANCELLED).length} tasks
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={handleClearFilters}>
            <X className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        </div>
      </Card>

      {/* Kanban Board */}
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              id={column.id}
              title={column.title}
              tasks={getTasksByStatus(column.id)}
              onTaskClick={handleTaskClick}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask ? (
            <TaskCard task={activeTask} isDragging onClick={() => {}} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Modals */}
      <TaskDetailsModal
        isOpen={isDetailsModalOpen}
        onClose={() => {
          setIsDetailsModalOpen(false);
          setSelectedTask(null);
        }}
        task={selectedTask}
        onEdit={handleEditTask}
        onUpdate={() => {
          fetchTasks();
          setIsDetailsModalOpen(false);
          setSelectedTask(null);
        }}
      />

      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          fetchTasks();
          setIsCreateModalOpen(false);
        }}
      />

      {selectedTask && (
        <EditTaskModal
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setSelectedTask(null);
          }}
          task={selectedTask}
          onSuccess={() => {
            fetchTasks();
            setIsEditModalOpen(false);
            setSelectedTask(null);
          }}
        />
      )}
    </div>
  );
}
