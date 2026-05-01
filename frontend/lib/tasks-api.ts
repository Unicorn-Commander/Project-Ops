import api from './api';

export interface Task {
  id: string;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate: string | null;
  completedAt: string | null;
  projectId: string;
  assignedToId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  project?: {
    id: string;
    projectNumber: string;
    title: string;
    contactId?: string | null;
    clientName: string;
  };
  assignedTo?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
  };
  createdBy?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
  _count?: {
    comments: number;
  };
}

export interface TaskComment {
  id: string;
  content: string;
  taskId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

// Mirrors backend Prisma enum TaskType. Stale tax-domain values
// (DOCUMENT_REQUEST / IRS_CALL / FILING / QUESTION) carried over from the
// NorthbridgeTax CPA fork were wired into the kanban, modals, and task cards
// but no longer match the backend — every "filter by type" was returning
// zero hits. v1.6.13 brought these back in sync.
export enum TaskType {
  TASK = 'TASK',
  MILESTONE = 'MILESTONE',
  DELIVERABLE = 'DELIVERABLE',
  REVIEW = 'REVIEW',
  MEETING = 'MEETING',
  RESEARCH = 'RESEARCH',
  OTHER = 'OTHER',
}

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_FOR_CLIENT = 'WAITING_FOR_CLIENT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export interface CreateTaskData {
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  dueDate?: string;
  projectId: string;
  assignedToId?: string;
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string;
  assignedToId?: string;
}

export interface TasksResponse {
  data: Task[];
  total: number;
  skip: number;
  take: number;
}

export interface TaskFilters {
  skip?: number;
  take?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  projectId?: string;
  assignedToId?: string;
  search?: string;
  sort?: string;
}

// Get all tasks with pagination and filters
export const getTasks = async (params?: TaskFilters): Promise<TasksResponse> => {
  const response = await api.get('/tasks', { params });
  return response.data;
};

// Get single task by ID
export const getTask = async (id: string): Promise<Task> => {
  const response = await api.get(`/tasks/${id}`);
  return response.data;
};

// Create new task
export const createTask = async (data: CreateTaskData): Promise<Task> => {
  const response = await api.post('/tasks', data);
  return response.data;
};

// Update task
export const updateTask = async (
  id: string,
  data: UpdateTaskData
): Promise<Task> => {
  const response = await api.patch(`/tasks/${id}`, data);
  return response.data;
};

// Delete task
export const deleteTask = async (id: string): Promise<void> => {
  await api.delete(`/tasks/${id}`);
};

// Update task status
export const updateTaskStatus = async (
  id: string,
  status: TaskStatus
): Promise<Task> => {
  const response = await api.patch(`/tasks/${id}/status`, { status });
  return response.data;
};

// Assign task to user
export const assignTask = async (
  id: string,
  userId: string
): Promise<Task> => {
  const response = await api.patch(`/tasks/${id}/assign`, { assignedToId: userId });
  return response.data;
};

// Mark task as complete
export const markTaskComplete = async (id: string): Promise<Task> => {
  const response = await api.post(`/tasks/${id}/complete`);
  return response.data;
};

// Get all tasks for a project
export const getProjectTasks = async (
  projectId: string,
  params?: { skip?: number; take?: number; status?: TaskStatus }
): Promise<TasksResponse> => {
  const response = await api.get(`/tasks/project/${projectId}`, { params });
  return response.data;
};

// Get tasks assigned to current user
export const getMyTasks = async (params?: {
  skip?: number;
  take?: number;
  status?: TaskStatus;
}): Promise<TasksResponse> => {
  const response = await api.get('/tasks/my-tasks', { params });
  return response.data;
};

// Get overdue tasks
export const getOverdueTasks = async (params?: {
  skip?: number;
  take?: number;
}): Promise<TasksResponse> => {
  const response = await api.get('/tasks/overdue', { params });
  return response.data;
};

// Task Comments
export const getTaskComments = async (taskId: string): Promise<TaskComment[]> => {
  const response = await api.get(`/tasks/${taskId}/comments`);
  return response.data;
};

export const addTaskComment = async (
  taskId: string,
  content: string
): Promise<TaskComment> => {
  const response = await api.post(`/tasks/${taskId}/comments`, { content });
  return response.data;
};

export const deleteTaskComment = async (
  taskId: string,
  commentId: string
): Promise<void> => {
  await api.delete(`/tasks/${taskId}/comments/${commentId}`);
};
