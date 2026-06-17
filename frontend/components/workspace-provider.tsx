"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import api from "@/lib/api";
import { logger } from "@/lib/logger";
import { useAuthStore } from "@/lib/store";
import {
  WORKSPACE_HEADER_NAME,
  clearWorkspaceStorage,
  getStoredWorkspaceId,
  getStoredWorkspaces,
  resolveActiveWorkspaceId,
  setStoredWorkspaceId,
  setStoredWorkspaces,
  type WorkspaceMembership,
} from "@/lib/workspace";

interface WorkspaceContextValue {
  workspaces: WorkspaceMembership[];
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceMembership | null;
  isLoading: boolean;
  switchWorkspace: (workspaceId: string) => void;
  /**
   * Re-fetch the caller's memberships from `/auth/profile` and re-seed the
   * switcher. Returns the fresh list. Used after creating/joining a workspace
   * or changing one's own membership so the switcher reflects it without a full
   * page reload.
   */
  refreshWorkspaces: () => Promise<WorkspaceMembership[]>;
  /**
   * Optimistically add (or replace) a membership in the switcher — e.g. right
   * after `POST /workspaces` returns the new workspace — so it appears
   * instantly, ahead of the next `/auth/profile` round-trip.
   */
  addWorkspace: (workspace: WorkspaceMembership) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(
  undefined,
);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  // Seed synchronously from localStorage so the switcher renders immediately
  // on reload, before `/auth/profile` re-hydrates the list.
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>(() =>
    getStoredWorkspaces(),
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    () => getStoredWorkspaceId(),
  );
  const [isLoading, setIsLoading] = useState(true);

  // Fetch `/auth/profile` (which carries `workspaces[]`), re-seed state +
  // storage, and re-resolve the active workspace. Shared by the auth-state
  // hydration effect and the public `refreshWorkspaces()`.
  const loadWorkspaces = useCallback(async (): Promise<
    WorkspaceMembership[]
  > => {
    const response = await api.get("/auth/profile");
    const next: WorkspaceMembership[] = Array.isArray(
      response.data?.workspaces,
    )
      ? response.data.workspaces
      : [];
    setWorkspaces(next);
    setStoredWorkspaces(next);

    const resolved = resolveActiveWorkspaceId(next, getStoredWorkspaceId());
    setActiveWorkspaceId(resolved);
    if (resolved) {
      setStoredWorkspaceId(resolved);
    }
    return next;
  }, []);

  // Hydrate / clear memberships in response to the auth state. When
  // authenticated we re-fetch `/auth/profile`; when logged out we drop
  // everything from memory + storage so the next user never inherits the
  // previous selection.
  useEffect(() => {
    let cancelled = false;

    if (!isAuthenticated) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      clearWorkspaceStorage();
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    loadWorkspaces()
      .catch((error) => {
        // A failed profile fetch must not wedge the app — fall back to whatever
        // was cached in localStorage (already seeded into state).
        if (!cancelled) {
          logger.warn(
            "⚠️ WorkspaceProvider: failed to load /auth/profile",
            error,
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, loadWorkspaces]);

  // Public refresh: a thin wrapper that swallows nothing (callers may want to
  // surface an error toast) but never throws the app into an unhandled state.
  const refreshWorkspaces = useCallback(async (): Promise<
    WorkspaceMembership[]
  > => {
    try {
      return await loadWorkspaces();
    } catch (error) {
      logger.warn("⚠️ WorkspaceProvider: refreshWorkspaces failed", error);
      return workspaces;
    }
  }, [loadWorkspaces, workspaces]);

  // Optimistic insert: append or replace by workspaceId, persist, and keep the
  // current active selection (creating a workspace doesn't auto-switch).
  const addWorkspace = useCallback((workspace: WorkspaceMembership) => {
    setWorkspaces((current) => {
      const without = current.filter(
        (ws) => ws.workspaceId !== workspace.workspaceId,
      );
      const next = [...without, workspace];
      setStoredWorkspaces(next);
      return next;
    });
  }, []);

  const switchWorkspace = useCallback(
    (workspaceId: string) => {
      const match = workspaces.find((ws) => ws.workspaceId === workspaceId);
      if (!match) {
        return;
      }
      setActiveWorkspaceId(workspaceId);
      setStoredWorkspaceId(workspaceId);
    },
    [workspaces],
  );

  // SINGLE window.fetch override. axios already carries `X-Workspace-Id` via
  // its request interceptor; this covers any incidental raw fetch (Next.js,
  // third-party libs) and chains the header AFTER any existing Authorization.
  // SSR-guarded and restored on unmount. This is the ONLY window.fetch wrap in
  // the app (blueprint R7 — no double-wrap).
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const originalFetch = window.fetch;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const workspaceId = getStoredWorkspaceId();
      if (workspaceId) {
        const headers = new Headers(init?.headers ?? {});
        if (!headers.has(WORKSPACE_HEADER_NAME)) {
          headers.set(WORKSPACE_HEADER_NAME, workspaceId);
        }
        init = { ...init, headers };
      }
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
    // Re-bind when the active workspace changes so a freshly switched id is
    // captured even by callers that read the closure rather than storage.
  }, [activeWorkspaceId]);

  const activeWorkspace = useMemo(
    () =>
      workspaces.find((ws) => ws.workspaceId === activeWorkspaceId) ?? null,
    [workspaces, activeWorkspaceId],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      isLoading,
      switchWorkspace,
      refreshWorkspaces,
      addWorkspace,
    }),
    [
      workspaces,
      activeWorkspaceId,
      activeWorkspace,
      isLoading,
      switchWorkspace,
      refreshWorkspaces,
      addWorkspace,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}
