"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AtSign,
  Bell,
  CheckCheck,
  Loader2,
  MessageSquare,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Notification, NotificationType } from "@/lib/notifications-api";

interface NotificationInboxProps {
  items: Notification[];
  loading: boolean;
  error: string | null;
  unreadCount: number;
  markingAll: boolean;
  onSelect: (n: Notification) => void;
  onMarkAll: () => void;
  onRetry: () => void;
}

/** Compact relative-time string, e.g. "just now", "5m", "3h", "2d". Falls
 *  back to a short calendar date past a week so old items stay legible. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Map a notification kind to a small leading icon. Unknown kinds get the
 *  generic bell so new server-side types still render sensibly. */
function iconFor(type: NotificationType) {
  switch (type) {
    case "MENTION":
      return AtSign;
    case "ASSIGNED":
      return UserPlus;
    case "COMMENT":
      return MessageSquare;
    default:
      return Bell;
  }
}

export function NotificationInbox({
  items,
  loading,
  error,
  unreadCount,
  markingAll,
  onSelect,
  onMarkAll,
  onRetry,
}: NotificationInboxProps) {
  const isEmpty = !loading && !error && items.length === 0;

  return (
    <div className="flex max-h-[28rem] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            Notifications
          </span>
          {unreadCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={onMarkAll}
          disabled={markingAll || unreadCount === 0}
        >
          {markingAll ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <CheckCheck className="h-3.5 w-3.5" aria-hidden />
          )}
          Mark all read
        </Button>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && (
          <ul className="divide-y divide-border/60" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex gap-3 px-3 py-3">
                <Skeleton className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </li>
            ))}
          </ul>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Bell className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-sm font-medium text-foreground">
              You&apos;re all caught up
            </p>
            <p className="text-xs text-muted-foreground">
              New notifications will show up here.
            </p>
          </div>
        )}

        {!loading && !error && items.length > 0 && (
          <ul className="divide-y divide-border/60">
            {items.map((n) => {
              const Icon = iconFor(n.type);
              const unread = !n.readAt;
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(n)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors",
                      "hover:bg-muted/60 focus:bg-muted/60 focus:outline-none",
                      unread && "bg-indigo-500/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                        unread
                          ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300"
                          : "bg-muted text-muted-foreground",
                      )}
                      aria-hidden
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span
                          className={cn(
                            "line-clamp-2 text-sm",
                            unread
                              ? "font-semibold text-foreground"
                              : "font-medium text-foreground/90",
                          )}
                        >
                          {n.title}
                        </span>
                        <span className="mt-0.5 shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
                          {relativeTime(n.createdAt)}
                        </span>
                      </span>
                      {n.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                    </span>
                    {/* Unread dot */}
                    {unread && (
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500"
                        aria-label="Unread"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
