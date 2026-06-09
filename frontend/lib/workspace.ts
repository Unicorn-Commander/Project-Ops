/**
 * Workspace (tenant) identity + storage helpers for the Phase-2 tenancy
 * switcher. Mirrors the Meeting-Ops `utils/organization.ts` pattern, adapted
 * to Project-Ops' workspace model (SUITE-IDENTITY §D4).
 *
 * The backend returns the caller's active memberships on login + `/auth/profile`
 * as `workspaces[]`, shaped exactly like `ActiveWorkspaceMembership`:
 *   { workspaceId, slug, displayName, role, isDefault }  (default-first)
 *
 * On the wire, the selected workspace is addressed via the `X-Workspace-Id`
 * header — the middle tier of the guard's D4 precedence:
 *   path param `workspaceId`/`workspace_id` > `X-Workspace-Id` header > claim.
 */

/** One active workspace membership — matches backend `ActiveWorkspaceMembership`. */
export interface WorkspaceMembership {
  workspaceId: string;
  slug: string;
  displayName: string;
  role: string;
  isDefault: boolean;
}

/** localStorage key for the currently-selected workspaceId. */
export const WORKSPACE_STORAGE_KEY = "projectops.activeWorkspaceId";
/**
 * localStorage key for the cached memberships list. The login response is not
 * persisted as a whole, so we cache `workspaces[]` here to seed the switcher
 * instantly on reload before `/auth/profile` re-hydrates it.
 */
export const WORKSPACES_STORAGE_KEY = "projectops.workspaces";
/** The request header the backend guard reads (D4 middle tier). */
export const WORKSPACE_HEADER_NAME = "X-Workspace-Id";

/** SSR-safe: true only when a real browser `window`/`localStorage` exists. */
function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getStoredWorkspaceId(): string | null {
  if (!hasStorage()) {
    return null;
  }
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredWorkspaceId(workspaceId: string): void {
  if (!hasStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, workspaceId);
  } catch {
    // Ignore storage failures and rely on in-memory state.
  }
}

export function clearStoredWorkspaceId(): void {
  if (!hasStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function getStoredWorkspaces(): WorkspaceMembership[] {
  if (!hasStorage()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(WORKSPACES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WorkspaceMembership[]) : [];
  } catch {
    return [];
  }
}

export function setStoredWorkspaces(workspaces: WorkspaceMembership[]): void {
  if (!hasStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(workspaces));
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Clear all workspace state from storage. Called on logout so a different user
 * never inherits the previous user's selected/cached workspaces.
 */
export function clearWorkspaceStorage(): void {
  clearStoredWorkspaceId();
  if (!hasStorage()) {
    return;
  }
  try {
    window.localStorage.removeItem(WORKSPACES_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

/**
 * Pick the active workspaceId from a list of memberships, honoring a previously
 * stored selection when it is still a valid member; otherwise prefer the
 * default workspace, then the first entry. Returns null for an empty list.
 */
export function resolveActiveWorkspaceId(
  workspaces: WorkspaceMembership[],
  storedWorkspaceId?: string | null,
): string | null {
  if (workspaces.length === 0) {
    return null;
  }

  if (storedWorkspaceId) {
    const storedMatch = workspaces.find((ws) => ws.workspaceId === storedWorkspaceId);
    if (storedMatch) {
      return storedMatch.workspaceId;
    }
  }

  if (workspaces.length === 1) {
    return workspaces[0].workspaceId;
  }

  const defaultWs = workspaces.find((ws) => ws.isDefault);
  return (defaultWs ?? workspaces[0]).workspaceId;
}
