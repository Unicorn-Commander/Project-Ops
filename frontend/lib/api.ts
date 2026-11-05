import axios from 'axios';
import { WORKSPACE_HEADER_NAME, getStoredWorkspaceId } from './workspace';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: inject the auth token, then chain the active-workspace
// header AFTER it (D4 precedence — the `X-Workspace-Id` header is read by the
// backend WorkspaceMembershipGuard). axios is the single HTTP transport for
// the app, so adding the header here decorates every API request. (A matching
// window.fetch override in WorkspaceProvider covers any incidental raw fetch.)
api.interceptors.request.use(
  (config) => {
    // Only access localStorage if we're in the browser
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      const workspaceId = getStoredWorkspaceId();
      if (workspaceId && !config.headers[WORKSPACE_HEADER_NAME]) {
        config.headers[WORKSPACE_HEADER_NAME] = workspaceId;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for handling auth errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      // Handle token refresh or redirect to login
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('user');
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);

export default api;

/**
 * Body for POST /projects/:projectId/clone (CloneProjectDto).
 * The source workspace is the active workspace: api's request interceptor
 * sets `X-Workspace-Id` the same way every other project call does. Do not
 * put the target workspace in that header — it belongs in `targetWorkspaceId`.
 */
export type CloneDueDateMode = 'keep' | 'shift' | 'clear';

export interface CloneProjectOptions {
  targetWorkspaceId?: string;
  title?: string;
  includeTasks?: boolean;
  resetStatus?: boolean;
  dueDateMode?: CloneDueDateMode;
  /** YYYY-MM-DD. Sent only when dueDateMode is `shift`. */
  startDate?: string;
}

export interface CloneProjectResult {
  project: {
    id: string;
    title: string;
    projectNumber?: string;
    workspaceId?: string;
  };
  taskCount: number;
  dependencyCount: number;
  skipped: {
    dependencies: number;
    assignees: number;
    customFields: number;
  };
}

const CLONE_DUE_DATE_MODES: readonly CloneDueDateMode[] = ['keep', 'shift', 'clear'];

/** Request path + JSON body for a clone. Defaults match the API: copy tasks, reset status, shift dates. */
export function buildCloneProjectRequest(
  projectId: string,
  options: CloneProjectOptions = {},
): { url: string; body: Record<string, unknown> } {
  const id = projectId.trim();
  if (!id) {
    throw new Error('projectId is required');
  }

  const dueDateMode = options.dueDateMode ?? 'shift';
  if (!CLONE_DUE_DATE_MODES.includes(dueDateMode)) {
    throw new Error('dueDateMode must be keep, shift, or clear');
  }

  const body: Record<string, unknown> = {
    includeTasks: options.includeTasks !== false,
    resetStatus: options.resetStatus !== false,
    dueDateMode,
  };

  const title = options.title?.trim();
  if (title) {
    body.title = title;
  }

  const targetWorkspaceId = options.targetWorkspaceId?.trim();
  if (targetWorkspaceId) {
    body.targetWorkspaceId = targetWorkspaceId;
  }

  const startDate = options.startDate?.trim();
  if (dueDateMode === 'shift' && startDate) {
    body.startDate = startDate;
  }

  return { url: `/projects/${id}/clone`, body };
}

/** Clone a project. Throws the axios error on failure; callers show it. */
export async function cloneProject(
  projectId: string,
  options: CloneProjectOptions = {},
): Promise<CloneProjectResult> {
  const request = buildCloneProjectRequest(projectId, options);
  const response = await api.post<CloneProjectResult>(request.url, request.body);
  return response.data;
}