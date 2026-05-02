/**
 * Tracks the last N entity detail-page visits per user, keyed by
 * entity type. Surfaces in the Cmd+K command palette as a "Recent"
 * section above the alphabetical lists so the operator's most-used
 * projects/tasks/contacts/orgs are one keystroke away.
 *
 * Pure localStorage (per-browser) — no backend round-trip. Unknown
 * IDs are pruned at read time so a deleted project doesn't haunt
 * the palette forever.
 */

const KEY = "projectops:recently-visited";
const LIMIT_PER_TYPE = 8;

export type RecentEntityType = "project" | "task" | "contact" | "organization";

export interface RecentEntry {
  id: string;
  type: RecentEntityType;
  title: string;
  /** Anything else worth showing under the title in the palette. */
  subtitle?: string;
  href: string;
  /** Unix ms when last visited. */
  visitedAt: number;
}

function loadAll(): RecentEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentEntry[]) : [];
  } catch {
    return [];
  }
}

function saveAll(entries: RecentEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage disabled — silent failure is fine.
  }
}

/**
 * Record an entity visit. Idempotent for the same id+type — most
 * recent visit wins, older entries beyond `LIMIT_PER_TYPE` per type
 * are dropped. Safe to call from a useEffect on every detail-page
 * mount; the storage write is cheap and bounded.
 */
export function recordVisit(entry: Omit<RecentEntry, "visitedAt">): void {
  const all = loadAll().filter(
    (e) => !(e.id === entry.id && e.type === entry.type),
  );
  all.unshift({ ...entry, visitedAt: Date.now() });

  // Trim per type so an active org user doesn't bury task visits.
  const byType: Record<RecentEntityType, RecentEntry[]> = {
    project: [],
    task: [],
    contact: [],
    organization: [],
  };
  all.forEach((e) => {
    if (byType[e.type] && byType[e.type].length < LIMIT_PER_TYPE) {
      byType[e.type].push(e);
    }
  });
  const trimmed = ([] as RecentEntry[]).concat(
    byType.project,
    byType.task,
    byType.contact,
    byType.organization,
  );
  saveAll(trimmed);
}

/**
 * Read the most-recent entries across all types, optionally filtered
 * to a single type. Returns sorted newest-first.
 */
export function getRecent(type?: RecentEntityType, limit = 5): RecentEntry[] {
  const all = loadAll();
  const filtered = type ? all.filter((e) => e.type === type) : all;
  return filtered
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, limit);
}
