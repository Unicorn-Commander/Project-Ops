import api from './api';
import type { WorkspaceMembership } from './workspace';

/**
 * Workspace & member management API ("easy sharing"). Wraps the backend
 * `/workspaces` controller. The selected/active workspace is still addressed by
 * the `X-Workspace-Id` header (api.ts interceptor); these calls additionally
 * carry the TARGET workspace in the PATH, which is what the backend guard reads
 * (D4: path param wins).
 */

/** Canonical suite roles, ranked viewer < member < manager < admin < owner. */
export type WorkspaceRole = 'VIEWER' | 'MEMBER' | 'MANAGER' | 'ADMIN' | 'OWNER';

export interface WorkspaceMember {
  /** uchub sub / keycloakId / local id — or `invite:<token>` for a pending invite. */
  userKey: string;
  role: WorkspaceRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
  isDefault: boolean;
  /** True for an outstanding `invite:<token>` row (no user account yet). */
  pending: boolean;
  createdAt: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    name: string;
  } | null;
}

/** Result of adding a member: either an existing user joined, or an invite was issued. */
export type AddMemberResult =
  | {
      kind: 'member';
      userKey: string;
      role: WorkspaceRole;
      email: string;
      invited: false;
    }
  | {
      kind: 'invite';
      email: string;
      role: WorkspaceRole;
      invited: true;
      inviteToken: string;
      inviteUrl: string;
    };

/** Create a new workspace; the caller becomes OWNER. Returns the switcher entry. */
export const createWorkspace = async (
  displayName: string,
): Promise<WorkspaceMembership> => {
  const response = await api.post('/workspaces', { displayName });
  return response.data;
};

/** List members (and pending invites) of a workspace. Caller must be a member. */
export const getWorkspaceMembers = async (
  workspaceId: string,
): Promise<WorkspaceMember[]> => {
  const response = await api.get(`/workspaces/${workspaceId}/members`);
  return response.data;
};

/** Add/share a workspace by email + role. OWNER or ADMIN only. */
export const addWorkspaceMember = async (
  workspaceId: string,
  data: { email: string; role: WorkspaceRole },
): Promise<AddMemberResult> => {
  const response = await api.post(`/workspaces/${workspaceId}/members`, data);
  return response.data;
};

/** Change a member's role. OWNER only. */
export const updateWorkspaceMemberRole = async (
  workspaceId: string,
  userKey: string,
  role: WorkspaceRole,
): Promise<WorkspaceMember> => {
  const response = await api.patch(
    `/workspaces/${workspaceId}/members/${encodeURIComponent(userKey)}`,
    { role },
  );
  return response.data;
};

/** Remove a member (or revoke a pending invite). OWNER only. */
export const removeWorkspaceMember = async (
  workspaceId: string,
  userKey: string,
): Promise<void> => {
  await api.delete(
    `/workspaces/${workspaceId}/members/${encodeURIComponent(userKey)}`,
  );
};
