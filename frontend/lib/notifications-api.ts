import api from './api';

/**
 * In-app notification for the current user in the active workspace.
 *
 * Shapes mirror the backend `notifications` module exactly. All fields after
 * `title` are optional because the backend only populates them for the
 * notification kinds that carry them (e.g. an entity link or an actor).
 */
export interface Notification {
  id: string;
  /** Backend enum; e.g. MENTION, ASSIGNED, COMMENT. Kept as a widened string
   *  union so unknown future kinds still render rather than throwing. */
  type: NotificationType;
  title: string;
  body?: string | null;
  /** The kind of thing this notification points at, when it links somewhere. */
  entityType?: string | null;
  /** The id of the linked entity (project id, task id, …). */
  entityId?: string | null;
  /** The user who triggered the notification, when applicable. */
  actorId?: string | null;
  /** ISO timestamp the notification was read, or null/absent while unread. */
  readAt?: string | null;
  createdAt: string;
}

/**
 * Known notification kinds. Widened with `(string & {})` so the type stays
 * exhaustive for the cases we branch on (icons) while still accepting any new
 * server-side kind without a frontend deploy.
 */
export type NotificationType =
  | 'MENTION'
  | 'ASSIGNED'
  | 'COMMENT'
  | (string & {});

export interface NotificationListMeta {
  total: number;
  unreadCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface NotificationListResponse {
  data: Notification[];
  meta: NotificationListMeta;
}

export interface ListNotificationsParams {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
}

/**
 * List the current user's notifications, newest first. Auth + the active
 * `X-Workspace-Id` header are injected by the shared axios instance, so the
 * result is already scoped to the user in the active workspace.
 */
export const listNotifications = async (
  params?: ListNotificationsParams,
): Promise<NotificationListResponse> => {
  const response = await api.get('/notifications', { params });
  return response.data;
};

/** Lightweight unread badge count — cheap to poll. */
export const getUnreadCount = async (): Promise<number> => {
  const response = await api.get('/notifications/unread-count');
  return response.data?.count ?? 0;
};

/** Mark a single notification read; returns the updated notification. */
export const markNotificationRead = async (
  id: string,
): Promise<Notification> => {
  const response = await api.patch(`/notifications/${id}/read`);
  return response.data;
};

/** Mark every unread notification read; returns how many were updated. */
export const markAllNotificationsRead = async (): Promise<number> => {
  const response = await api.post('/notifications/read-all');
  return response.data?.updated ?? 0;
};
