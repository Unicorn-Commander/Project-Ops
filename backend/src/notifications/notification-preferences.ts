/**
 * Per-user EMAIL notification preferences (closes the Settings
 * "Notifications — coming soon" stub).
 *
 * IN-APP notifications are ALWAYS on and are NOT gated by anything here — these
 * preferences govern EMAIL delivery only. The shape is a master `email` toggle
 * plus a per-event-type map, persisted on `User.notificationPreferences` (a
 * nullable Json column). `null`/absent => {@link DEFAULT_PREFERENCES}.
 *
 * DIGEST / BATCHING IS OUT OF SCOPE: this layer sends an immediate per-event
 * email. The shape intentionally leaves room for a future `digest` field (see
 * {@link NotificationPreferences.digest}) so batching can be added later
 * without a breaking migration — but nothing reads it today.
 */

/**
 * Canonical EMAIL preference keys (one per notify-worthy event class). Adding a
 * new emailable event = add a key here + a default + a template + a mapping in
 * {@link EVENT_TO_PREFERENCE_KEY}. Keep these stable: they are persisted.
 */
export const PreferenceKey = {
  /** A task was assigned to me. High-signal — default ON. */
  TASK_ASSIGNED: 'task_assigned',
  /** I was @mentioned (in a task comment today). High-signal — default ON. */
  MENTION: 'mention',
  /** A comment was added on something I follow (non-mention). Reserved — default OFF. */
  TASK_COMMENT: 'task_comment',
  /** An approval was requested of me (e.g. a timesheet submitted). High-signal — default ON. */
  APPROVAL_REQUESTED: 'approval_requested',
  /** A task I'm on changed status. Noisy — default OFF. */
  TASK_STATUS_CHANGED: 'task_status_changed',
  /** A task I'm on was completed. Noisy — default OFF. */
  TASK_COMPLETED: 'task_completed',
  /** A task was created on my project. Noisy — default OFF. */
  TASK_CREATED: 'task_created',
  /** A project I'm on changed status. Noisy — default OFF. */
  PROJECT_STATUS_CHANGED: 'project_status_changed',
  /** A project was created. Noisy — default OFF. */
  PROJECT_CREATED: 'project_created',
} as const;

export type PreferenceKey = (typeof PreferenceKey)[keyof typeof PreferenceKey];

/** Every known preference key as an array (drives validation + merge). */
export const ALL_PREFERENCE_KEYS: PreferenceKey[] = Object.values(PreferenceKey);

/** The per-event-type enablement map. */
export type EventPreferenceMap = Record<PreferenceKey, boolean>;

/**
 * A user's full email-notification preferences.
 *
 * `email` is the master switch (off => no email at all, regardless of the map).
 * `events` is the per-type map. `digest` is reserved for a FUTURE batching
 * feature and is NOT consumed yet (immediate-send only).
 */
export interface NotificationPreferences {
  email: boolean;
  events: EventPreferenceMap;
  /**
   * RESERVED — extension point for future digest/batching. Not read today; the
   * service sends one email per event immediately. Persisted verbatim if a
   * client sends it, so a later release can adopt it without a migration.
   */
  digest?: { enabled: boolean; frequency?: 'daily' | 'weekly' };
}

/**
 * Sensible defaults applied when the column is null OR a key is absent from the
 * stored map. Email ON for the high-signal events (assignment, @mention,
 * approval requested); OFF for the noisy ones.
 */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  email: true,
  events: {
    [PreferenceKey.TASK_ASSIGNED]: true,
    [PreferenceKey.MENTION]: true,
    [PreferenceKey.APPROVAL_REQUESTED]: true,
    [PreferenceKey.TASK_COMMENT]: false,
    [PreferenceKey.TASK_STATUS_CHANGED]: false,
    [PreferenceKey.TASK_COMPLETED]: false,
    [PreferenceKey.TASK_CREATED]: false,
    [PreferenceKey.PROJECT_STATUS_CHANGED]: false,
    [PreferenceKey.PROJECT_CREATED]: false,
  },
};

/**
 * Map each notify-worthy DOMAIN EVENT name to the preference key that gates its
 * email. The email listener consumes these events; the in-app Notifications
 * listener is unaffected. A comment event maps to MENTION because the only
 * comment-driven notification today is the @mention fan-out.
 */
export const EVENT_TO_PREFERENCE_KEY: Record<string, PreferenceKey> = {
  'task.assigned': PreferenceKey.TASK_ASSIGNED,
  'task.comment.created': PreferenceKey.MENTION,
  'task.status_changed': PreferenceKey.TASK_STATUS_CHANGED,
  'task.completed': PreferenceKey.TASK_COMPLETED,
  'task.created': PreferenceKey.TASK_CREATED,
  'project.status_changed': PreferenceKey.PROJECT_STATUS_CHANGED,
  'project.created': PreferenceKey.PROJECT_CREATED,
  // Approval-style: a submitted timesheet is a request for someone to approve.
  'timesheet.submitted': PreferenceKey.APPROVAL_REQUESTED,
};

/**
 * Merge a raw stored value (the `User.notificationPreferences` Json, possibly
 * null / partial / malformed) OVER {@link DEFAULT_PREFERENCES}. Defensive:
 * unknown keys are dropped, non-boolean values fall back to the default, and a
 * null/garbage input yields the full defaults. Always returns a complete,
 * type-correct object — callers never see a partial map.
 */
export function mergePreferences(raw: unknown): NotificationPreferences {
  const base: NotificationPreferences = {
    email: DEFAULT_PREFERENCES.email,
    events: { ...DEFAULT_PREFERENCES.events },
  };

  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return base;
  }

  const stored = raw as Record<string, unknown>;

  if (typeof stored.email === 'boolean') {
    base.email = stored.email;
  }

  const events = stored.events;
  if (events && typeof events === 'object' && !Array.isArray(events)) {
    for (const key of ALL_PREFERENCE_KEYS) {
      const val = (events as Record<string, unknown>)[key];
      if (typeof val === 'boolean') {
        base.events[key] = val;
      }
    }
  }

  // Preserve a forward-compatible digest block verbatim if present + well-formed,
  // so a future release can read it. Never consumed here.
  const digest = stored.digest;
  if (digest && typeof digest === 'object' && !Array.isArray(digest)) {
    const enabled = (digest as Record<string, unknown>).enabled;
    if (typeof enabled === 'boolean') {
      const freq = (digest as Record<string, unknown>).frequency;
      base.digest = {
        enabled,
        ...(freq === 'daily' || freq === 'weekly' ? { frequency: freq } : {}),
      };
    }
  }

  return base;
}

/** A PARTIAL preferences update (PATCH body): every field — incl. each event key — optional. */
export interface PreferencePatch {
  email?: boolean;
  events?: Partial<Record<PreferenceKey, boolean>>;
  digest?: { enabled: boolean; frequency?: 'daily' | 'weekly' };
}

/**
 * Apply a validated PARTIAL update over the user's CURRENT (merged) preferences
 * and return the new full object to persist. `email` is replaced when present;
 * `events` is shallow-merged key-by-key (a PATCH only touches the keys it
 * sends); `digest` is replaced when present. The result is always complete +
 * normalized via {@link mergePreferences}.
 */
export function applyPreferencePatch(
  current: NotificationPreferences,
  patch: PreferencePatch,
): NotificationPreferences {
  const next: NotificationPreferences = {
    email: typeof patch.email === 'boolean' ? patch.email : current.email,
    events: { ...current.events, ...(patch.events ?? {}) },
    ...(patch.digest !== undefined
      ? { digest: patch.digest }
      : current.digest !== undefined
        ? { digest: current.digest }
        : {}),
  };
  // Re-normalize so any stray keys a caller might have slipped past validation
  // are dropped and the object is canonical.
  return mergePreferences(next);
}

/**
 * The gate: should an email fire for `eventName` to a recipient with `prefs`,
 * given the actor? Returns false when there is no mapping for the event, the
 * master toggle is off, the per-event key is off, or the recipient IS the
 * actor (never email someone about their own action). Workspace email-config
 * availability is checked separately by the caller (it needs an async lookup).
 */
export function shouldEmail(params: {
  eventName: string;
  prefs: NotificationPreferences;
  recipientUserId: string;
  actorUserId?: string | null;
}): boolean {
  const { eventName, prefs, recipientUserId, actorUserId } = params;
  if (actorUserId && actorUserId === recipientUserId) return false;
  if (!prefs.email) return false;
  const key = EVENT_TO_PREFERENCE_KEY[eventName];
  if (!key) return false;
  return prefs.events[key] === true;
}
