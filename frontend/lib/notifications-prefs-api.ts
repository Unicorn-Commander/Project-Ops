/**
 * Notification-preferences API client.
 *
 * Wraps the backend `GET`/`PATCH /notifications/preferences` endpoints. Mirrors
 * the hand-rolled axios pattern used across the app (`lib/notifications-api.ts`,
 * `lib/capacity-api.ts`): every call goes through the shared `api` instance in
 * `lib/api.ts`, which injects the Bearer `access_token` and the `X-Workspace-Id`
 * header — so the result is already scoped to the calling user in the active
 * workspace.
 *
 * These preferences gate EMAIL delivery only. In-app notifications (the bell)
 * are always on; the UI copy says so. `email` is the master switch; the
 * per-event booleans gate individual email kinds underneath it.
 */

import api from "./api";

// ---------------------------------------------------------------------------
// Shapes — mirror the backend notifications-preferences payload exactly.
// ---------------------------------------------------------------------------

/**
 * The per-event email toggles. Keys mirror the backend notification kinds the
 * email pipeline can send. All booleans.
 */
export interface NotificationEventPrefs {
  task_assigned: boolean;
  mention: boolean;
  approval_requested: boolean;
  task_comment: boolean;
  task_status_changed: boolean;
  task_completed: boolean;
  task_created: boolean;
  project_status_changed: boolean;
  project_created: boolean;
}

/** Every event key, in a stable order — used to normalise partial responses. */
export const NOTIFICATION_EVENT_KEYS: (keyof NotificationEventPrefs)[] = [
  "task_assigned",
  "mention",
  "approval_requested",
  "task_comment",
  "task_status_changed",
  "task_completed",
  "task_created",
  "project_status_changed",
  "project_created",
];

/** Full preferences payload: master email switch + per-event toggles. */
export interface NotificationPreferences {
  /** Master switch. When false, no notification email is sent at all. */
  email: boolean;
  events: NotificationEventPrefs;
}

/**
 * Partial update body for PATCH. Either field may be omitted, and `events` may
 * carry only the keys that changed (the backend merges partials).
 */
export interface NotificationPreferencesPatch {
  email?: boolean;
  events?: Partial<NotificationEventPrefs>;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/** Fetch the calling user's notification (email) preferences. */
export const getNotificationPreferences =
  async (): Promise<NotificationPreferences> => {
    const { data } = await api.get<NotificationPreferences>(
      "/notifications/preferences",
    );
    return data;
  };

/**
 * Partially update the calling user's preferences. Pass only what changed
 * (e.g. `{ email: false }` or `{ events: { mention: true } }`). Returns the
 * full, server-canonical preferences after the merge.
 */
export const updateNotificationPreferences = async (
  patch: NotificationPreferencesPatch,
): Promise<NotificationPreferences> => {
  const { data } = await api.patch<NotificationPreferences>(
    "/notifications/preferences",
    patch,
  );
  return data;
};
