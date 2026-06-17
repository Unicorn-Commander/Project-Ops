/**
 * Saved-views shared constants.
 *
 * A saved view captures a reusable list configuration (filters / sort / visible
 * columns) for a given surface ("scope"). Scopes are an open, known-string set —
 * any list surface in Project-Ops can add one here without a schema change (the
 * `scope` column is a plain string fenced by RLS per workspace).
 */

/**
 * The list surfaces a saved view can target. Kept as a closed allow-list so a
 * caller can't persist an arbitrary scope string (which would never be read by
 * any surface and just be dead rows). Extend this when a new list surface gains
 * saved-view support.
 */
export const SAVED_VIEW_SCOPES = [
  'projects',
  'tasks',
  'time-entries',
  'comments',
  'documents',
  'contacts',
  'organizations',
] as const;

export type SavedViewScope = (typeof SAVED_VIEW_SCOPES)[number];

/**
 * Hard cap on the serialized `config` payload (filters/sort/columns), in bytes.
 * A saved view is a small UI preset, not a document store; this keeps a caller
 * from stuffing arbitrarily large JSON into the row. 16 KiB is generous for a
 * column list + filter set while still being a firm guardrail.
 */
export const MAX_SAVED_VIEW_CONFIG_BYTES = 16 * 1024;
