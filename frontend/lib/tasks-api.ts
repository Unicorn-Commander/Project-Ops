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
  parentTaskId?: string | null;
  assignedToId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  /** RRULE subset (FREQ=DAILY|WEEKLY|MONTHLY[;INTERVAL=N]); set => recurrence template. */
  recurrenceRule?: string | null;
  /** Effort estimate in hours (capacity planning). Decimal — may arrive as a string. */
  estimatedHours?: number | string | null;
  /** Flat fee for this task. Decimal — may arrive as a string. */
  fixedAmount?: number | string | null;
  invoicedAt?: string | null;
  /**
   * Free-form entity metadata. Custom-field VALUES live under
   * `metadata.customFields`, keyed by the workspace TASK field key.
   */
  metadata?: {
    customFields?: Record<string, any>;
    [key: string]: any;
  } | null;
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
    subtasks?: number;
  };
}

// ── Task dependencies (Push B) ──────────────────────────────────────────────
// A directed edge: the SUCCESSOR depends on the PREDECESSOR. The backend
// returns both directions from GET /tasks/:id/dependencies:
//   dependsOn — edges where this task is the successor (each carries the
//               `predecessor` summary it waits on).
//   blocks    — edges where this task is the predecessor (each carries the
//               `successor` summary waiting on it).
export enum TaskDependencyType {
  FINISH_TO_START = 'FINISH_TO_START',
  START_TO_START = 'START_TO_START',
  FINISH_TO_FINISH = 'FINISH_TO_FINISH',
  START_TO_FINISH = 'START_TO_FINISH',
}

// Direction relative to the task in the URL (`:id`) when creating an edge.
export enum DependencyDirection {
  DEPENDS_ON = 'DEPENDS_ON',
  BLOCKS = 'BLOCKS',
}

/** The related-task summary embedded in a dependency edge. */
export interface TaskDependencyTaskSummary {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  projectId: string;
}

/** A single dependency edge as returned by the API. */
export interface TaskDependency {
  id: string;
  type: TaskDependencyType;
  predecessorId: string;
  successorId: string;
  createdById: string;
  createdAt: string;
  /** Present on `dependsOn[]` edges (the task this one waits on). */
  predecessor?: TaskDependencyTaskSummary;
  /** Present on `blocks[]` edges (the task waiting on this one). */
  successor?: TaskDependencyTaskSummary;
}

export interface TaskDependencies {
  dependsOn: TaskDependency[];
  blocks: TaskDependency[];
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
  status?: TaskStatus;
  dueDate?: string;
  projectId: string;
  parentTaskId?: string;
  assignedToId?: string;
  /** RRULE subset; when set the task becomes a recurrence template. */
  recurrenceRule?: string;
  /** Effort estimate in hours (>= 0, up to 2 decimals). */
  estimatedHours?: number;
  fixedAmount?: number;
  /**
   * Custom-field VALUES keyed by the workspace TASK field key. Validated +
   * normalized server-side against the workspace definitions, then merged into
   * metadata.customFields.
   */
  customFields?: Record<string, any>;
}

export interface UpdateTaskData {
  title?: string;
  description?: string;
  type?: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueDate?: string;
  assignedToId?: string;
  recurrenceRule?: string;
  estimatedHours?: number;
  fixedAmount?: number | null;
  customFields?: Record<string, any>;
}

export interface TasksResponse {
  data: Task[];
  total: number;
  skip: number;
  take: number;
}

// Columns the backend `GET /tasks` listing may be sorted by.
export type TaskSortBy = 'createdAt' | 'dueDate' | 'priority' | 'status' | 'title';
export type TaskSortDir = 'asc' | 'desc';

// Query params for `GET /tasks` (the rich listing endpoint — findAll).
// NOTE: pagination is `page`/`pageSize` (1-based; pageSize clamped to 100
// server-side), NOT skip/take. `search` is a case-insensitive substring match
// on title OR description; `sortBy`/`sortDir` push sorting to the DB.
export interface TaskFilters {
  page?: number;
  pageSize?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: string;
  assignedToId?: string;
  createdById?: string;
  parentTaskId?: string;
  search?: string;
  sortBy?: TaskSortBy;
  sortDir?: TaskSortDir;
  /** Only tasks with dueDate strictly before this ISO timestamp. */
  dueBefore?: string;
  /** Only tasks with dueDate at or after this ISO timestamp. */
  dueAfter?: string;
}

// Get all tasks with pagination, filters, free-text search and sort.
// Empty / "ALL" values should be omitted by the caller so they don't reach
// the (enum-validated) backend.
export const getTasks = async (params?: TaskFilters): Promise<TasksResponse> => {
  const response = await api.get('/tasks', { params });
  return response.data;
};

// Alias for the rich `GET /tasks` listing, named to read at call sites that
// want "list the tasks matching these filters" (e.g. the project task
// timeline does `listTasks({ projectId, pageSize: 200 })`). Identical to
// {@link getTasks} — same params, same paginated response.
export const listTasks = getTasks;

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

// Get all tasks for a project. NOTE: GET /tasks/project/:projectId returns a
// BARE Task[] (not the paginated {data,...} envelope of GET /tasks) — other
// callers (time-tracking, task-details dependency picker) rely on that shape.
export const getProjectTasks = async (
  projectId: string,
  params?: { skip?: number; take?: number; status?: TaskStatus }
): Promise<Task[]> => {
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

// ── Subtasks (Push B) ───────────────────────────────────────────────────────

// Get the direct subtasks of a task. Each subtask carries assignedTo /
// createdBy and its own `_count` (comments + subtasks). 404s if the parent
// isn't visible in the active workspace.
export const getSubtasks = async (taskId: string): Promise<Task[]> => {
  const response = await api.get(`/tasks/${taskId}/subtasks`);
  return response.data;
};

// ── Dependencies (Push B) ───────────────────────────────────────────────────

// Get a task's dependencies in both directions.
export const getTaskDependencies = async (
  taskId: string
): Promise<TaskDependencies> => {
  const response = await api.get(`/tasks/${taskId}/dependencies`);
  return response.data;
};

export interface AddDependencyData {
  /** The id of the OTHER task to link to. */
  taskId: string;
  /** DEPENDS_ON (default): the URL task depends on `taskId`. BLOCKS: it blocks `taskId`. */
  direction?: DependencyDirection;
  /** Defaults to FINISH_TO_START server-side. */
  type?: TaskDependencyType;
}

// Create a dependency between `taskId` (the URL task) and `data.taskId`.
// 400 on self / duplicate / cycle; 404 if a task isn't visible.
export const addTaskDependency = async (
  taskId: string,
  data: AddDependencyData
): Promise<TaskDependency> => {
  const response = await api.post(`/tasks/${taskId}/dependencies`, data);
  return response.data;
};

export const removeTaskDependency = async (
  taskId: string,
  dependencyId: string
): Promise<void> => {
  await api.delete(`/tasks/${taskId}/dependencies/${dependencyId}`);
};
