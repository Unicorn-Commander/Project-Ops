"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/lib/notifications-api";
import { logger } from "@/lib/logger";
import { NotificationInbox } from "./notification-inbox";

/** How often to refresh the unread badge while the bell is mounted. */
const POLL_INTERVAL_MS = 30_000;
/** How many notifications to show in the dropdown inbox. */
const INBOX_PAGE_SIZE = 15;

/**
 * Resolve the in-app route a notification links to. Returns `null` when the
 * notification carries no navigable target (informational only).
 *
 * - PROJECT → the project detail page (`/dashboard/projects/<id>`), which
 *   exists in the app router.
 * - TASK → there is no standalone task detail route, so we land on the
 *   user's task list, which is the accepted fallback.
 */
export function notificationHref(n: Notification): string | null {
  const entityType = n.entityType?.toUpperCase();
  if (entityType === "PROJECT" && n.entityId) {
    return `/dashboard/projects/${n.entityId}`;
  }
  if (entityType === "TASK") {
    return "/dashboard/my-tasks";
  }
  return null;
}

/**
 * Top-bar notification bell with an unread-count badge and a dropdown inbox.
 *
 * The unread count polls every 30s (and pauses while the tab is hidden to
 * avoid pointless background requests) and is also refreshed every time the
 * inbox opens. Opening the inbox additionally fetches the recent list.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const [items, setItems] = useState<Notification[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  // Avoid setting state after unmount (polling + async fetches outlive a
  // quick mount/unmount during navigation).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const count = await getUnreadCount();
      if (mountedRef.current) setUnreadCount(count);
    } catch (err) {
      // The badge is non-critical; log quietly and leave the last good value.
      logger.warn(
        "notifications: unread-count failed: " +
          ((err as Error)?.message ?? "unknown"),
      );
    }
  }, []);

  // Poll the unread count. Skip while the tab is hidden, and fire an
  // immediate refresh whenever it becomes visible again.
  useEffect(() => {
    refreshUnreadCount();

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (typeof document === "undefined" || !document.hidden) {
          refreshUnreadCount();
        }
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refreshUnreadCount();
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refreshUnreadCount]);

  const loadInbox = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const res = await listNotifications({ page: 1, limit: INBOX_PAGE_SIZE });
      if (!mountedRef.current) return;
      setItems(res.data);
      // The list response carries an authoritative unread count — use it to
      // keep the badge in sync with what the user is actually looking at.
      setUnreadCount(res.meta.unreadCount);
    } catch (err) {
      if (!mountedRef.current) return;
      logger.warn(
        "notifications: list failed: " +
          ((err as Error)?.message ?? "unknown"),
      );
      setListError("Couldn't load notifications.");
    } finally {
      if (mountedRef.current) setListLoading(false);
    }
  }, []);

  // Refetch the list + count every time the inbox opens.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        loadInbox();
      }
    },
    [loadInbox],
  );

  const handleSelect = useCallback(
    async (n: Notification) => {
      const href = notificationHref(n);
      // Optimistically mark read so the dot clears immediately.
      const wasUnread = !n.readAt;
      if (wasUnread) {
        setItems((prev) =>
          prev.map((it) =>
            it.id === n.id
              ? { ...it, readAt: new Date().toISOString() }
              : it,
          ),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      }
      setOpen(false);
      if (href) router.push(href);

      if (wasUnread) {
        try {
          await markNotificationRead(n.id);
        } catch (err) {
          // Re-sync from the server rather than guessing on failure.
          logger.warn(
            "notifications: mark-read failed: " +
              ((err as Error)?.message ?? "unknown"),
          );
          refreshUnreadCount();
        }
      }
    },
    [router, refreshUnreadCount],
  );

  const handleMarkAll = useCallback(async () => {
    if (markingAll) return;
    setMarkingAll(true);
    // Optimistic: clear all dots + the badge.
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((it) => (it.readAt ? it : { ...it, readAt: now })),
    );
    setUnreadCount(0);
    try {
      await markAllNotificationsRead();
    } catch (err) {
      logger.warn(
        "notifications: mark-all failed: " +
          ((err as Error)?.message ?? "unknown"),
      );
      // Reload to reflect true state if the bulk update didn't take.
      loadInbox();
    } finally {
      if (mountedRef.current) setMarkingAll(false);
    }
  }, [markingAll, loadInbox]);

  const hasUnread = unreadCount > 0;
  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            hasUnread
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <Bell className="h-5 w-5" aria-hidden />
          {hasUnread && (
            <span
              className={cn(
                "absolute -right-0.5 -top-0.5 inline-flex min-w-[1.05rem] items-center justify-center",
                "rounded-full bg-amber-500 px-1 text-[10px] font-bold leading-[1.05rem] text-white",
                "ring-2 ring-card",
              )}
              aria-hidden
            >
              {badgeLabel}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      >
        <NotificationInbox
          items={items}
          loading={listLoading}
          error={listError}
          unreadCount={unreadCount}
          markingAll={markingAll}
          onSelect={handleSelect}
          onMarkAll={handleMarkAll}
          onRetry={loadInbox}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
