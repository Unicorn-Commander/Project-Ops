/**
 * Per-user starred entities — local-only flagged sets surfaced in the
 * Cmd+K palette as a permanent "Starred" section above Recent. Like
 * recently-visited but explicit: the user picks.
 *
 * Scoped per entity type (projects / contacts / organizations) so each
 * list page maintains its own set without collision.
 *
 * Lives in localStorage. No backend round-trip; cross-device sync would
 * mean a backend table — filed for later if anyone asks.
 */

import { useEffect, useState, useCallback } from "react";

export type StarredScope = "projects" | "contacts" | "organizations";

const KEY_PREFIX = "projectops:starred:";
const EVENT = "projectops:starred-changed";

function keyFor(scope: StarredScope): string {
  return `${KEY_PREFIX}${scope}`;
}

function loadSet(scope: StarredScope): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(keyFor(scope));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSet(scope: StarredScope, set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(keyFor(scope), JSON.stringify([...set]));
  } catch {
    // ignore
  }
  // Notify other live components on the same page so the star icon
  // updates everywhere on click. (storage events fire only across
  // tabs, not within a tab.)
  window.dispatchEvent(
    new CustomEvent(EVENT, { detail: { scope } }),
  );
}

export function isStarred(scope: StarredScope, id: string): boolean {
  return loadSet(scope).has(id);
}

export function getStarred(scope: StarredScope): string[] {
  return [...loadSet(scope)];
}

export function toggleStarred(scope: StarredScope, id: string): boolean {
  const set = loadSet(scope);
  let next: boolean;
  if (set.has(id)) {
    set.delete(id);
    next = false;
  } else {
    set.add(id);
    next = true;
  }
  saveSet(scope, set);
  return next;
}

/**
 * React hook: subscribe to the live starred set for one scope. Updates
 * immediately when any caller flips a star on this page; also picks up
 * changes from other tabs via the storage event.
 */
export function useStarred(scope: StarredScope): {
  starred: Set<string>;
  toggle: (id: string) => void;
} {
  const [starred, setStarred] = useState<Set<string>>(() => loadSet(scope));

  useEffect(() => {
    const onChange = (e: Event) => {
      // CustomEvent same-tab path carries detail.scope; storage event
      // (cross-tab) doesn't, so rebuild defensively when the scope's
      // own key changes.
      const ce = e as CustomEvent<{ scope?: StarredScope }>;
      if (e.type === EVENT) {
        if (!ce.detail || ce.detail.scope === scope) {
          setStarred(loadSet(scope));
        }
        return;
      }
      const se = e as StorageEvent;
      if (se.key === keyFor(scope) || se.key === null) {
        setStarred(loadSet(scope));
      }
    };
    window.addEventListener("storage", onChange);
    window.addEventListener(EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(EVENT, onChange);
    };
  }, [scope]);

  const toggle = useCallback(
    (id: string) => {
      toggleStarred(scope, id);
    },
    [scope],
  );

  return { starred, toggle };
}
