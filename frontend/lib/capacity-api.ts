/**
 * Capacity / resource-planning API client.
 *
 * Wraps the backend NestJS Capacity module (`backend/src/capacity/**`). Mirrors
 * the hand-rolled axios pattern used across the app (`lib/time-tracking-api.ts`,
 * `lib/tasks-api.ts`): every call goes through the shared `api` instance in
 * `lib/api.ts`, which injects the Bearer `access_token` and the `X-Workspace-Id`
 * header.
 *
 * Conventions taken straight from `capacity.service.ts`:
 *   - All hours come back as JS `number` (Prisma Decimal → number, 2dp).
 *   - `utilizationPct` is a percentage (committed / capacity * 100, 1–2dp).
 *   - Capacity is PRO-RATED to the window: `weeklyCapacityHours * windowDays / 7`.
 *   - `overAllocated` === committed strictly exceeds capacity.
 *   - `from` / `to` are ISO strings; `windowDays` is the inclusive day count.
 *   - GET `/capacity` and PATCH `/capacity/users/:id` are ADMIN/MANAGER (403 else);
 *     GET `/capacity/me` is open to any active member.
 */

import api from "./api";

// ---------------------------------------------------------------------------
// Response shapes — mirror capacity.service.ts (UserCapacityRow / CapacityReport).
// ---------------------------------------------------------------------------

/** One row of the per-user capacity report. */
export interface UserCapacityRow {
  userId: string;
  name: string;
  /** Pro-rated capacity for the window (weekly budget * windowDays / 7). */
  capacityHours: number;
  /** Sum of estimatedHours over in-window, not-done, assigned tasks. */
  committedHours: number;
  /** committed / capacity, as a percentage (0 when capacity is 0). */
  utilizationPct: number;
  /** committed strictly exceeds capacity. */
  overAllocated: boolean;
  /** All in-window, not-done assigned tasks (estimated or not). */
  taskCount: number;
  /** In-window, not-done assigned tasks with NO estimate (the visible gap). */
  unestimatedCount: number;
}

/** Workspace rollup across all rows in the report. */
export interface CapacityTotals {
  capacityHours: number;
  committedHours: number;
  utilizationPct: number;
  overAllocatedCount: number;
  taskCount: number;
  unestimatedCount: number;
}

/** The full capacity report: window + per-user rows + workspace totals. */
export interface CapacityReport {
  from: string; // ISO
  to: string; // ISO
  windowDays: number;
  users: UserCapacityRow[];
  totals: CapacityTotals;
}

/** Result of PATCH /capacity/users/:userId. */
export interface SetCapacityResult {
  userId: string;
  name: string;
  weeklyCapacityHours: number;
}

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

export interface CapacityWindowInput {
  from?: string; // ISO
  to?: string; // ISO
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Team capacity across the window (ADMIN/MANAGER — backend 403s STAFF/CLIENT).
 * Omitting from/to defaults to the current week (Mon→Sun) server-side.
 */
export const getTeamCapacity = async (
  params?: CapacityWindowInput,
): Promise<CapacityReport> => {
  const { data } = await api.get("/capacity", { params });
  return data;
};

/** The current user's own workload (any active member) — single-row report. */
export const getMyCapacity = async (
  params?: CapacityWindowInput,
): Promise<CapacityReport> => {
  const { data } = await api.get("/capacity/me", { params });
  return data;
};

/**
 * Set a member's weekly capacity hours (ADMIN/MANAGER; backend bounds 0–168 via
 * the DTO, 404 when the target isn't a member of the active workspace).
 */
export const setUserCapacity = async (
  userId: string,
  weeklyCapacityHours: number,
): Promise<SetCapacityResult> => {
  const { data } = await api.patch(`/capacity/users/${userId}`, {
    weeklyCapacityHours,
  });
  return data;
};

// ---------------------------------------------------------------------------
// Small client-side helpers (load → semantic tone).
// ---------------------------------------------------------------------------

/** Load band for a utilization %, matching the green/amber/red rubric. */
export type LoadBand = "under" | "near" | "over";

/**
 * Classify a row's load:
 *   - "over"  : over-allocated (committed > capacity, i.e. >100%)
 *   - "near"  : 85–100% (amber — at risk)
 *   - "under" : <85% (green — has headroom)
 * Reads `overAllocated` from the row when given so the band always agrees with
 * the server's strict-exceeds definition (a row at exactly 100% is "near", not
 * "over").
 */
export function loadBand(
  utilizationPct: number,
  overAllocated?: boolean,
): LoadBand {
  if (overAllocated || utilizationPct > 100) return "over";
  if (utilizationPct >= 85) return "near";
  return "under";
}

/** Round hours for display (1dp), tolerating null/undefined. */
export function fmtHours(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "0h";
  return `${(Math.round(value * 10) / 10).toFixed(1)}h`;
}
