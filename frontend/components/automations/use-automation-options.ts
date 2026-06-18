"use client";

import { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";

/**
 * Loads the user + project lists used by the rule builder's pickers and by the
 * summary builder's id→name lookups. Both endpoints are the same ones the rest
 * of the dashboard uses (`/users`, `/projects`), and both return the standard
 * `{ data: [...] }` envelope. Fetched lazily (call sites pass `enabled` so the
 * lists only load when the page/builder actually needs them).
 */

export interface UserOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  role?: string;
}

export interface ProjectOption {
  id: string;
  title: string;
  projectNumber?: string;
}

export function userDisplayName(u: UserOption | undefined): string {
  if (!u) return "(unknown user)";
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.email || "(unknown user)";
}

export function projectDisplayName(p: ProjectOption | undefined): string {
  if (!p) return "(unknown project)";
  return p.projectNumber ? `${p.projectNumber} · ${p.title}` : p.title;
}

interface AutomationOptions {
  users: UserOption[];
  projects: ProjectOption[];
  loading: boolean;
  /** id → display name; falls back to a friendly placeholder for unknown ids. */
  userName: (id: string) => string;
  projectName: (id: string) => string;
  reload: () => void;
}

export function useAutomationOptions(enabled = true): AutomationOptions {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, pRes] = await Promise.all([
        api.get("/users", { params: { page: 1, limit: 500 } }),
        api.get("/projects", { params: { page: 1, limit: 1000 } }),
      ]);
      const uList: UserOption[] = uRes.data?.data ?? uRes.data ?? [];
      const pList: ProjectOption[] = pRes.data?.data ?? pRes.data ?? [];
      setUsers(uList);
      setProjects(pList);
    } catch {
      // Pickers degrade gracefully to empty lists; the page still renders and
      // the builder's free-text/validation paths keep working.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  const userName = useCallback(
    (id: string) => {
      if (!id) return "someone";
      const u = users.find((x) => x.id === id);
      return u ? userDisplayName(u) : "(unknown user)";
    },
    [users],
  );

  const projectName = useCallback(
    (id: string) => {
      if (!id) return "(no project)";
      const p = projects.find((x) => x.id === id);
      return p ? projectDisplayName(p) : "(unknown project)";
    },
    [projects],
  );

  return { users, projects, loading, userName, projectName, reload: load };
}
