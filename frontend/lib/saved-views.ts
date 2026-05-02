/**
 * localStorage-backed view presets per list page. A "view" is a frozen
 * snapshot of filter + sort + search state — name it once, restore it
 * with one click. Built-in defaults ship per scope so a brand-new
 * dashboard already has useful starting points.
 *
 * Scopes are short identifiers ("projects" / "tasks" / "contacts" /
 * etc) so two list pages can both have a "My open" preset without
 * collision.
 *
 * The State shape is intentionally a string-keyed map — each list
 * page knows what keys it cares about. Unknown keys are ignored at
 * apply time, so adding a filter later doesn't break old saved views.
 */

export interface SavedView {
  id: string;
  name: string;
  /** Frozen filter/sort/search state. Keys + values are page-defined. */
  state: Record<string, string>;
  /** True for shipped defaults — not editable / deletable from the UI. */
  builtIn?: boolean;
}

const KEY_PREFIX = "projectops:saved-views:";

export function loadUserViews(scope: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + scope);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

export function saveUserViews(scope: string, views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(views));
  } catch {
    // localStorage may be full or disabled (private window) — silent
    // failure is fine; the user just doesn't get persistence.
  }
}

/**
 * Built-in starting presets per scope. These are always shown above
 * the user-saved views in the dropdown and can't be deleted.
 */
export const BUILT_IN_VIEWS: Record<string, SavedView[]> = {
  projects: [
    {
      id: "b-active",
      name: "Active only",
      builtIn: true,
      state: { filterStatus: "IN_PROGRESS", sortBy: "updatedAt-desc" },
    },
    {
      id: "b-urgent",
      name: "Urgent priority",
      builtIn: true,
      state: { filterPriority: "URGENT", sortBy: "dueDate-asc" },
    },
    {
      id: "b-recent",
      name: "Recently updated",
      builtIn: true,
      state: { sortBy: "updatedAt-desc" },
    },
  ],
  tasks: [
    {
      id: "b-pending",
      name: "Pending",
      builtIn: true,
      state: { filterStatus: "PENDING", sortBy: "dueDate-asc" },
    },
    {
      id: "b-in-progress",
      name: "In progress",
      builtIn: true,
      state: { filterStatus: "IN_PROGRESS", sortBy: "dueDate-asc" },
    },
    {
      id: "b-urgent",
      name: "Urgent priority",
      builtIn: true,
      state: { filterPriority: "URGENT", sortBy: "dueDate-asc" },
    },
  ],
  contacts: [
    {
      id: "b-active",
      name: "Active only",
      builtIn: true,
      state: { filterActiveLabel: "ACTIVE", sortBy: "lastName-asc" },
    },
    {
      id: "b-recent",
      name: "Recently updated",
      builtIn: true,
      state: { sortBy: "updatedAt-desc" },
    },
  ],
  organizations: [
    {
      id: "b-agencies",
      name: "Agencies only",
      builtIn: true,
      state: { type: "AGENCY" },
    },
    {
      id: "b-businesses",
      name: "Businesses only",
      builtIn: true,
      state: { type: "BUSINESS" },
    },
  ],
  documents: [
    {
      id: "b-pdfs",
      name: "PDFs only",
      builtIn: true,
      state: { filterType: "pdf", sortBy: "createdAt-desc" },
    },
    {
      id: "b-images",
      name: "Images only",
      builtIn: true,
      state: { filterType: "image", sortBy: "createdAt-desc" },
    },
  ],
  users: [
    {
      id: "b-admins",
      name: "Admins",
      builtIn: true,
      state: { filterRole: "ADMIN" },
    },
    {
      id: "b-active",
      name: "Active only",
      builtIn: true,
      state: { filterActive: "ACTIVE", sortBy: "lastName-asc" },
    },
  ],
};

export function getAllViews(scope: string): SavedView[] {
  return [...(BUILT_IN_VIEWS[scope] ?? []), ...loadUserViews(scope)];
}
