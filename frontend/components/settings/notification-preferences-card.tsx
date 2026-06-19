"use client";

/**
 * Notification preferences card.
 *
 * Wires the settings page to GET/PATCH `/notifications/preferences` via
 * `lib/notifications-prefs-api.ts`. A master "Email notifications" switch sits
 * above a list of per-event toggles (high-signal events first). Every change
 * saves immediately and optimistically: the UI flips first, a PATCH carrying
 * just the delta fires, and we reconcile to the server's canonical response on
 * success (or roll back + toast on failure).
 *
 * These preferences gate EMAIL only — in-app notifications (the bell) are
 * always on. The copy says so.
 *
 * Hydration: nothing here reads localStorage / Date in render. Preferences load
 * in a mount effect; until then we render a small skeleton, so the server render
 * and first client render agree.
 */

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { iconWellClass } from "@/lib/badge-styles";
import { HelpHint } from "@/components/guidance";
import { Bell, Loader2 } from "lucide-react";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
  type NotificationEventPrefs,
  type NotificationPreferences,
} from "@/lib/notifications-prefs-api";

/**
 * Per-event display metadata. Order here IS the on-screen order — the
 * high-signal, person-directed events lead, then status/lifecycle, then the
 * noisier creation firehoses last.
 */
const EVENT_META: {
  key: keyof NotificationEventPrefs;
  label: string;
  description: string;
}[] = [
  {
    key: "task_assigned",
    label: "Task assigned to me",
    description: "Someone assigns you a task, or reassigns one to you.",
  },
  {
    key: "mention",
    label: "Mentions",
    description: "Someone @-mentions you in a task or comment.",
  },
  {
    key: "approval_requested",
    label: "Approval requested",
    description: "A client decision or sign-off is requested from you.",
  },
  {
    key: "task_comment",
    label: "Comments on my tasks",
    description: "A new comment is posted on a task you're on.",
  },
  {
    key: "task_status_changed",
    label: "Task status changes",
    description: "A task you follow moves to a new status.",
  },
  {
    key: "task_completed",
    label: "Task completed",
    description: "A task you follow is marked complete.",
  },
  {
    key: "task_created",
    label: "New tasks created",
    description: "A task is created in a project you can see.",
  },
  {
    key: "project_status_changed",
    label: "Project status changes",
    description: "A project you can see moves to a new status.",
  },
  {
    key: "project_created",
    label: "New projects created",
    description: "A new project is created in your workspace.",
  },
];

export function NotificationPreferencesCard() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Per-key in-flight flags so a row's switch disables only itself while saving.
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  // Guard against setting state after unmount (preferences fetch is async).
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      try {
        const data = await getNotificationPreferences();
        if (mounted.current) setPrefs(data);
      } catch (err: any) {
        if (mounted.current) {
          setError(
            err?.response?.data?.message ??
              "Couldn't load your notification preferences. Refresh and try again.",
          );
        }
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  function markSaving(key: string, on: boolean) {
    setSavingKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /** Optimistically flip the master email switch, PATCH, reconcile/rollback. */
  async function toggleMaster(value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, email: value });
    markSaving("email", true);
    try {
      const updated = await updateNotificationPreferences({ email: value });
      if (mounted.current) setPrefs(updated);
    } catch (err: any) {
      if (mounted.current) setPrefs(previous);
      toast({
        title: "Couldn't save",
        description:
          err?.response?.data?.message ?? "Your change wasn't saved. Try again.",
        variant: "destructive",
      });
    } finally {
      markSaving("email", false);
    }
  }

  /** Optimistically flip one event toggle, PATCH the delta, reconcile/rollback. */
  async function toggleEvent(key: keyof NotificationEventPrefs, value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, events: { ...prefs.events, [key]: value } });
    markSaving(key, true);
    try {
      const updated = await updateNotificationPreferences({
        events: { [key]: value },
      });
      if (mounted.current) setPrefs(updated);
    } catch (err: any) {
      if (mounted.current) setPrefs(previous);
      toast({
        title: "Couldn't save",
        description:
          err?.response?.data?.message ?? "Your change wasn't saved. Try again.",
        variant: "destructive",
      });
    } finally {
      markSaving(key, false);
    }
  }

  const emailOn = prefs?.email ?? false;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <div
          className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${iconWellClass(
            "amber",
          )}`}
        >
          <Bell className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-semibold">Notifications</h2>
            <HelpHint>
              In-app notifications (the bell) are always on. These switches
              control which of them are also emailed to you.
            </HelpHint>
          </div>
          <p className="text-xs text-muted-foreground">
            Choose which events email you. In-app notifications stay on
            regardless.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading preferences…
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          {error}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Master email switch */}
          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="pr-4">
              <div className="flex items-center gap-1.5">
                <Label
                  htmlFor="notif-email-master"
                  className="font-medium cursor-pointer"
                >
                  Email notifications
                </Label>
                <HelpHint>
                  The master switch. Turn this off to stop all notification
                  emails — your per-event choices below are kept and re-apply
                  when you turn it back on.
                </HelpHint>
              </div>
              <p className="text-sm text-muted-foreground">
                Send notification emails to your account address.
              </p>
            </div>
            <Switch
              id="notif-email-master"
              checked={emailOn}
              onCheckedChange={toggleMaster}
              disabled={savingKeys.has("email")}
              aria-label="Email notifications"
            />
          </div>

          {/* Per-event toggles. Dim + non-interactive while email is off. */}
          <fieldset
            disabled={!emailOn}
            className={
              emailOn
                ? "space-y-2"
                : "space-y-2 opacity-50 transition-opacity"
            }
          >
            <legend className="sr-only">Per-event email notifications</legend>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Email me about
            </p>
            {EVENT_META.map(({ key, label, description }) => {
              const id = `notif-event-${key}`;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border p-4"
                >
                  <div className="pr-4">
                    <Label
                      htmlFor={id}
                      className="font-medium cursor-pointer"
                    >
                      {label}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {description}
                    </p>
                  </div>
                  <Switch
                    id={id}
                    checked={prefs?.events[key] ?? false}
                    onCheckedChange={(v) => toggleEvent(key, v)}
                    disabled={!emailOn || savingKeys.has(key)}
                    aria-label={label}
                  />
                </div>
              );
            })}
          </fieldset>
        </div>
      )}
    </Card>
  );
}
