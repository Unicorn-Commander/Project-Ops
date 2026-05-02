/**
 * Per-user starred projects — local-only flagged set surfaced in the
 * Cmd+K palette as a permanent "Starred" section above Recent. Like
 * recently-visited but explicit: the user picks.
 *
 * Lives in localStorage. No backend round-trip; cross-device sync
 * would mean a backend table — filed for later if anyone asks.
 */

import { useEffect, useState, useCallback } from "react";

const KEY = "projectops:starred:projects";

function loadSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSet(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // ignore
  }
  // Notify other live components on the same page so the star icon
  // updates everywhere on click. (storage events fire only across
  // tabs, not within a tab.)
  window.dispatchEvent(new Event("projectops:starred-changed"));
}

export function isStarred(id: string): boolean {
  return loadSet().has(id);
}

export function getStarred(): string[] {
  return [...loadSet()];
}

export function toggleStarred(id: string): boolean {
  const set = loadSet();
  let next: boolean;
  if (set.has(id)) {
    set.delete(id);
    next = false;
  } else {
    set.add(id);
    next = true;
  }
  saveSet(set);
  return next;
}

/**
 * React hook: subscribe to the live starred set. Updates immediately
 * when any caller flips a star on this page; also picks up changes
 * from other tabs via the storage event.
 */
export function useStarred(): {
  starred: Set<string>;
  toggle: (id: string) => void;
} {
  const [starred, setStarred] = useState<Set<string>>(() => loadSet());

  useEffect(() => {
    const onChange = () => setStarred(loadSet());
    window.addEventListener("storage", onChange);
    window.addEventListener("projectops:starred-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("projectops:starred-changed", onChange);
    };
  }, []);

  const toggle = useCallback((id: string) => {
    toggleStarred(id);
  }, []);

  return { starred, toggle };
}
