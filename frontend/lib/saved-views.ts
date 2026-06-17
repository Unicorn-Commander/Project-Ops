/**
 * View presets per list page. A "view" is a frozen snapshot of filter +
 * sort + search state — name it once, restore it with one click. Built-in
 * defaults ship per scope so a brand-new dashboard already has useful
 * starting points.
 *
 * Persistence (changed): user-saved views now live in the backend
 * (`/saved-views`, see `lib/saved-views-api.ts`), so they sync cross-device
 * and support `shared` (visible to the whole workspace). A localStorage
 * cache mirrors the last-known set per scope so the dropdown paints
 * instantly on load and keeps working read-only if the API is unreachable.
 *
 * Back-compat: the synchronous public API the toolbar already imports
 * (`SavedView`, `loadUserViews`, `saveUserViews`, `getAllViews`,
 * `BUILT_IN_VIEWS`) is preserved and now operates against that cache. The
 * new async functions (`syncUserViews`, `createUserView`, `updateUserView`,
 * `deleteUserView`) are the source of truth — they hit the API, refresh the
 * cache, and never throw (failures fall back to the cache so the UI never
 * breaks). The `state` field maps to the backend's `config` JSON.
 *
 * Scopes are short identifiers ("projects" / "tasks" / "contacts" / etc) so
 * two list pages can both have a "My open" preset without collision.
 *
 * The State shape is intentionally a string-keyed map — each list page knows
 * what keys it cares about. Unknown keys are ignored at apply time, so adding
 * a filter later doesn't break old saved views.
 */

import {
  type SavedViewDto,
  listSavedViews,
  createSavedView,
  updateSavedView,
  deleteSavedView,
} from "@/lib/saved-views-api";

export interface SavedView {
  id: string;
  name: string;
  /** Frozen filter/sort/search state. Keys + values are page-defined. */
  state: Record<string, string>;
  /** True for shipped defaults — not editable / deletable from the UI. */
  builtIn?: boolean;
  /** Visible to the whole workspace when true (server-backed views only). */
  shared?: boolean;
  /** Owner's user id (server-backed views only). */
  ownerId?: string;
  /**
   * True when the calling user owns this view, i.e. may rename / delete /
   * toggle sharing. Built-ins and others' shared views are not owned.
   */
  ownedByMe?: boolean;
}

const KEY_PREFIX = "projectops:saved-views:";

/**
 * Map a backend DTO to the UI's SavedView. The caller passes the current
 * user id (when known) so we can mark `ownedByMe` — owner-only mutations are
 * still enforced server-side, this just drives whether the UI shows the
 * rename/delete/share affordances.
 */
function fromDto(dto: SavedViewDto, currentUserId?: string | null): SavedView {
  return {
    id: dto.id,
    name: dto.name,
    state: dto.config ?? {},
    shared: dto.shared,
    ownerId: dto.userId,
    ownedByMe: currentUserId != null ? dto.userId === currentUserId : undefined,
  };
}

// ---------------------------------------------------------------------------
// Synchronous cache layer (back-compat surface used by the toolbar for the
// instant first paint). These read/write the localStorage mirror only.
// ---------------------------------------------------------------------------

/** Read the cached user views for a scope (localStorage mirror). */
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

/** Overwrite the cached user views for a scope (localStorage mirror). */
export function saveUserViews(scope: string, views: SavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY_PREFIX + scope, JSON.stringify(views));
  } catch {
    // localStorage may be full or disabled (private window) — silent
    // failure is fine; the user just doesn't get the cache.
  }
}

// ---------------------------------------------------------------------------
// Async API layer (source of truth). All swallow errors and fall back to the
// cache so the UI never breaks when the backend is unavailable.
// ---------------------------------------------------------------------------

/**
 * Fetch the authoritative view list for a scope from the backend (the
 * caller's own + others' shared), refresh the local cache, and return it.
 * On any failure, returns the cached set so the UI degrades gracefully.
 */
export async function syncUserViews(
  scope: string,
  currentUserId?: string | null,
): Promise<SavedView[]> {
  try {
    const dtos = await listSavedViews(scope);
    const views = dtos.map((d) => fromDto(d, currentUserId));
    saveUserViews(scope, views);
    return views;
  } catch {
    return loadUserViews(scope);
  }
}

/**
 * Create a saved view via the API and refresh the cache. Returns the created
 * view, or `null` if the request failed (the caller already has the cache).
 */
export async function createUserView(
  scope: string,
  name: string,
  state: Record<string, string>,
  options?: { shared?: boolean; currentUserId?: string | null },
): Promise<SavedView | null> {
  try {
    const dto = await createSavedView({
      scope,
      name,
      config: state,
      shared: options?.shared ?? false,
    });
    const view = fromDto(dto, options?.currentUserId);
    // Refresh from the cache + append so the dropdown updates immediately
    // without a second round-trip.
    const next = [...loadUserViews(scope).filter((v) => v.id !== view.id), view];
    saveUserViews(scope, next);
    return view;
  } catch {
    return null;
  }
}

/**
 * Update an owned view (name / state / shared) via the API and refresh the
 * cache. Returns the updated view or `null` on failure.
 */
export async function updateUserView(
  scope: string,
  id: string,
  patch: { name?: string; state?: Record<string, string>; shared?: boolean },
  currentUserId?: string | null,
): Promise<SavedView | null> {
  try {
    const dto = await updateSavedView(id, {
      name: patch.name,
      config: patch.state,
      shared: patch.shared,
    });
    const view = fromDto(dto, currentUserId);
    const next = loadUserViews(scope).map((v) => (v.id === id ? view : v));
    saveUserViews(scope, next);
    return view;
  } catch {
    return null;
  }
}

/**
 * Delete an owned view via the API and drop it from the cache. Returns true
 * on success. On failure the cache is left intact and false is returned.
 */
export async function deleteUserView(scope: string, id: string): Promise<boolean> {
  try {
    await deleteSavedView(id);
    saveUserViews(scope, loadUserViews(scope).filter((v) => v.id !== id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Built-in starting presets per scope. These are always shown above the
 * user-saved views in the dropdown and can't be deleted.
 */
export const BUILT_IN_VIEWS: Record<string, SavedView[]> = {
  projects: [
    {
      id: "b-active",
      name: "Active only",
      builtIn: true,
      // sortBy/sortDir are now split (server-side sort on Projects). The
      // Projects page also tolerates the legacy combined "field-dir" form
      // for any views saved before the split.
      state: { filterStatus: "IN_PROGRESS", sortBy: "createdAt", sortDir: "desc" },
    },
    {
      id: "b-urgent",
      name: "Urgent priority",
      builtIn: true,
      state: { filterPriority: "URGENT", sortBy: "dueDate", sortDir: "asc" },
    },
    {
      id: "b-recent",
      name: "Recently created",
      builtIn: true,
      state: { sortBy: "createdAt", sortDir: "desc" },
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

/**
 * Built-ins followed by the cached user views. Synchronous, for instant first
 * paint — call `syncUserViews(scope)` to refresh the user portion from the
 * backend, then re-read with this.
 */
export function getAllViews(scope: string): SavedView[] {
  return [...(BUILT_IN_VIEWS[scope] ?? []), ...loadUserViews(scope)];
}
