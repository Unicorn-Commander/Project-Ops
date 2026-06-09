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

  // Hydrate / clear memberships in response to the auth state. When
  // authenticated we re-fetch `/auth/profile` (which carries `workspaces[]`);
  // when logged out we drop everything from memory + storage so the next user
  // never inherits the previous selection.
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
    api
      .get("/auth/profile")
      .then((response) => {
        if (cancelled) {
          return;
        }
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
      })
      .catch((error) => {
        // A failed profile fetch must not wedge the app — fall back to whatever
        // was cached in localStorage (already seeded into state).
        logger.warn("⚠️ WorkspaceProvider: failed to load /auth/profile", error);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

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
    }),
    [workspaces, activeWorkspaceId, activeWorkspace, isLoading, switchWorkspace],
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
