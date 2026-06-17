/**
 * Typed client for the DB-synced saved-views endpoints. A saved view is a
 * named, frozen filter/sort/search snapshot for a list page ("scope"); the
 * backend persists it per-workspace so views sync cross-device and can be
 * shared with the rest of the workspace.
 *
 * Wire shapes (exact — see backend SavedView controller):
 *   GET    /saved-views?scope=projects   -> SavedViewDto[]  (own + others' shared)
 *   POST   /saved-views   { scope, name, config, shared? }  -> SavedViewDto
 *   PATCH  /saved-views/:id  { name?, config?, shared? }     -> SavedViewDto (owner-only)
 *   DELETE /saved-views/:id                                  -> 204         (owner-only)
 *
 * Auth + active-workspace headers are injected by the shared axios instance
 * (`@/lib/api`), so this module just shapes requests/responses. Callers that
 * need offline resilience should layer a localStorage cache on top — this
 * client itself is a thin transport and surfaces network errors to the
 * caller (the cache layer in `saved-views.ts` is what swallows them).
 */

import api from "@/lib/api";

/**
 * One saved view as returned by the backend. `config` is page-defined JSON —
 * the same string-keyed filter/sort/search map the list pages already use as
 * a view's `state`. `userId` is the owner (the calling user for their own
 * views; another member for `shared` views surfaced in the workspace).
 */
export interface SavedViewDto {
  id: string;
  scope: string;
  name: string;
  /** Page-defined frozen filter/sort/search state. */
  config: Record<string, string>;
  shared: boolean;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSavedViewInput {
  scope: string;
  name: string;
  config: Record<string, string>;
  shared?: boolean;
}

export interface UpdateSavedViewInput {
  name?: string;
  config?: Record<string, string>;
  shared?: boolean;
}

/** List the caller's own views plus others' shared views for a scope. */
export async function listSavedViews(scope: string): Promise<SavedViewDto[]> {
  const res = await api.get<SavedViewDto[]>("/saved-views", {
    params: { scope },
  });
  return Array.isArray(res.data) ? res.data : [];
}

/** Create a new saved view (defaults to private unless `shared` is set). */
export async function createSavedView(
  input: CreateSavedViewInput,
): Promise<SavedViewDto> {
  const res = await api.post<SavedViewDto>("/saved-views", input);
  return res.data;
}

/** Update an owned view (name / config / shared flag). Owner-only server-side. */
export async function updateSavedView(
  id: string,
  input: UpdateSavedViewInput,
): Promise<SavedViewDto> {
  const res = await api.patch<SavedViewDto>(`/saved-views/${id}`, input);
  return res.data;
}

/** Delete an owned view. Owner-only server-side. */
export async function deleteSavedView(id: string): Promise<void> {
  await api.delete(`/saved-views/${id}`);
}
