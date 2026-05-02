/**
 * Shared cache for the staff/manager/admin list.
 *
 * Before this lived as a per-component fetch, every <AssignProject>
 * row on the projects list page (one per project) fired its own
 * `/users?limit=…` call. With 27+ projects in view, that meant 27+
 * simultaneous round-trips that hit the NestJS throttler and
 * sporadically returned 429s — the user saw "Failed to load team
 * members" toasts on a normal page render.
 *
 * Now: the first caller kicks off the request, every subsequent
 * caller awaits the same in-flight promise, and the result is
 * cached for the lifetime of the page (cleared on full reload).
 * `useTeamMembers()` is the React hook surface; `invalidate()` busts
 * the cache after a known mutation (new user, role change).
 */

import { useEffect, useState } from "react";
import api from "./api";

export interface TeamMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
}

let cached: TeamMember[] | null = null;
let inFlight: Promise<TeamMember[]> | null = null;

async function fetchTeamMembersOnce(): Promise<TeamMember[]> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const response = await api.get("/users?page=1&limit=500");
      const all = (response.data?.data ?? []) as TeamMember[];
      cached = all.filter(
        (u) => u.role === "STAFF" || u.role === "MANAGER" || u.role === "ADMIN",
      );
      return cached;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function invalidateTeamMembers(): void {
  cached = null;
  inFlight = null;
}

export function useTeamMembers(): {
  members: TeamMember[];
  loading: boolean;
  error: string | null;
} {
  const [members, setMembers] = useState<TeamMember[]>(cached ?? []);
  const [loading, setLoading] = useState<boolean>(cached === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (cached) {
      setMembers(cached);
      setLoading(false);
      return;
    }
    fetchTeamMembersOnce()
      .then((list) => {
        if (cancelled) return;
        setMembers(list);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.data?.message ?? "Failed to load team members");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { members, loading, error };
}
