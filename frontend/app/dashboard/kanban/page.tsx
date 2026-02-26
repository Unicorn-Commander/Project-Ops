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
  HelpCircle,
  Phone,
  Eye,
  Upload,
  CheckSquare,
  Calendar,
  User,
  AlertTriangle,
  Search,
} from 'lucide-react';
import { TaskDetailsModal } from '@/components/modals/task-details-modal';
import { CreateTaskModal } from '@/components/modals/create-task-modal';
import { EditTaskModal } from '@/components/modals/edit-task-modal';
import api from '@/lib/api';

// Interfaces
interface Client {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  company: string | null;
}

// Using Task type from tasks-api which includes project with contactId
// interface ProjectItem - removed, using project from Task type

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

// Task type icons mapping
const getTypeIcon = (type: TaskType) => {
  const icons: Record<TaskType, React.ReactElement> = {
    [TaskType.DOCUMENT_REQUEST]: <FileText className="h-4 w-4" />,
    [TaskType.QUESTION]: <HelpCircle className="h-4 w-4" />,
    [TaskType.IRS_CALL]: <Phone className="h-4 w-4" />,
    [TaskType.REVIEW]: <Eye className="h-4 w-4" />,
    [TaskType.FILING]: <Upload className="h-4 w-4" />,
    [TaskType.OTHER]: <CheckSquare className="h-4 w-4" />,
  };
  return icons[type];
};

// Priority colors mapping
const getPriorityColor = (priority: TaskPriority) => {
  const colors: Record<TaskPriority, string> = {
    [TaskPriority.LOW]: 'bg-gray-100 text-gray-800',
    [TaskPriority.MEDIUM]: 'bg-blue-100 text-blue-800',
    [TaskPriority.HIGH]: 'bg-orange-100 text-orange-800',
    [TaskPriority.URGENT]: 'bg-red-100 text-red-800',
  };
  return colors[priority];
};

// Status colors for columns
const statusColors: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: 'bg-blue-100 border-blue-300',
  [TaskStatus.IN_PROGRESS]: 'bg-yellow-100 border-yellow-300',
  [TaskStatus.WAITING_FOR_CLIENT]: 'bg-purple-100 border-purple-300',
  [TaskStatus.COMPLETED]: 'bg-green-100 border-green-300',
  [TaskStatus.CANCELLED]: 'bg-gray-100 border-gray-300',
};

const statusTextColors: Record<TaskStatus, string> = {
  [TaskStatus.PENDING]: 'text-blue-800',
  [TaskStatus.IN_PROGRESS]: 'text-yellow-800',
  [TaskStatus.WAITING_FOR_CLIENT]: 'text-purple-800',
  [TaskStatus.COMPLETED]: 'text-green-800',
  [TaskStatus.CANCELLED]: 'text-gray-800',
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

    if (diffDays < 0) return { text: `${Math.abs(diffDays)}d overdue`, color: 'text-red-600' };
    if (diffDays === 0) return { text: 'Due today', color: 'text-orange-600' };
    if (diffDays <= 3) return { text: `${diffDays}d left`, color: 'text-orange-600' };
    return { text: `${diffDays}d left`, color: 'text-gray-600' };
  };

  const dueInfo = task.dueDate ? formatDueDate(task.dueDate) : null;

  const getInitials = (firstName: string | null, lastName: string | null, email: string) => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    }
    return email.substring(0, 2).toUpperCase();
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-2">
      <Card
        className={`p-3 transition-all hover:shadow-md cursor-pointer ${
          isDragging || isDraggingState ? 'shadow-lg opacity-80' : ''
        } ${isOverdue ? 'border-l-4 border-l-red-500' : ''}`}
      >
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing select-none">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <div className="text-primary">{getTypeIcon(task.type)}</div>
              <h4 className="font-semibold text-sm text-gray-900 line-clamp-2">{task.title}</h4>
            </div>
            <Badge className={`text-xs ${getPriorityColor(task.priority)}`}>
              {task.priority}
            </Badge>
          </div>

          <div className="text-xs text-gray-600 mb-2">
            <div className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              <span className="font-mono">{task.project?.projectNumber}</span>
              <span className="mx-1">·</span>
              <span className="truncate">{task.project?.clientName}</span>
            </div>
          </div>

          {isOverdue && (
            <div className="flex items-center gap-1 text-xs text-red-600 font-semibold mb-2">
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
              <div
                className="h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center text-xs"
                title={`${task.assignedTo.firstName || ''} ${task.assignedTo.lastName || ''}`}
              >
                {getInitials(task.assignedTo.firstName, task.assignedTo.lastName, task.assignedTo.email)}
              </div>
            ) : (
              <span className="text-xs text-gray-400">Unassigned</span>
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
        className={`p-3 min-h-[calc(100vh-380px)] max-h-[calc(100vh-380px)] overflow-y-auto rounded-b-lg border-2 border-t-0 ${
          isOver ? 'bg-gray-50 border-dashed' : 'bg-white'
        } ${statusColors[id].split(' ')[1]}`}
      >
        {tasks.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            No tasks
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
  const [selectedClientId, setSelectedClientId] = useState<string>('ALL');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('ALL');
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('ALL');
  const [selectedPriority, setSelectedPriority] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<string>('ALL');

  // Filter data
  const [clients, setClients] = useState<Client[]>([]);
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
      // Fetch clients
      const clientsResponse = await api.get('/clients', { params: { page: 1, limit: 1000 } });
      setClients(clientsResponse.data.data || clientsResponse.data || []);

      // Fetch projects
      const projectsResponse = await api.get('/projects', { params: { page: 1, limit: 1000 } });
      setProjects(projectsResponse.data.projects || projectsResponse.data.data || projectsResponse.data || []);

      // Fetch users
      const usersResponse = await api.get('/users', { params: { page: 1, limit: 1000 } });
      setUsers(usersResponse.data.data || usersResponse.data || []);
    } catch (error) {
      // Error handling - reset data on error
      setClients([]);
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

    // Client filter
    if (selectedClientId && selectedClientId !== 'ALL') {
      filtered = filtered.filter((task) => task.project?.contactId === selectedClientId);
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
  }, [tasks, searchQuery, selectedClientId, selectedProjectId, selectedAssigneeId, selectedPriority, selectedType]);

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
    setSelectedClientId('ALL');
    setSelectedProjectId('ALL');
    setSelectedAssigneeId('ALL');
    setSelectedPriority('ALL');
    setSelectedType('ALL');
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  if (!mounted || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Task Kanban Board</h1>
          <p className="text-gray-600 mt-1">Drag and drop tasks to update their status</p>
        </div>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          {/* Search */}
          <div className="lg:col-span-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {/* Client Filter */}
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger>
              <SelectValue placeholder="All Clients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Clients</SelectItem>
              {clients.map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.firstName} {client.lastName} {client.company ? `(${client.company})` : ''}
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
            {/* Type Filter */}
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                {Object.values(TaskType).map((type) => (
                  <SelectItem key={type} value={type}>
                    {type.replace(/_/g, ' ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="text-sm text-gray-600">
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
