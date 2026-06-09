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