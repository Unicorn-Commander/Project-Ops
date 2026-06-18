"use client";

import * as React from "react";
import { Check, Clock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "@/lib/webhooks-api";

/**
 * Shared presentational helpers for the webhooks surface — kept in one place so
 * the list, the deliveries drawer, and the test results all read a delivery's
 * status/timestamps identically.
 */

const STATUS_TONE: Record<WebhookDeliveryStatus, string> = {
  SUCCESS: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  FAILED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  PENDING: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const STATUS_ICON: Record<
  WebhookDeliveryStatus,
  React.ComponentType<{ className?: string }>
> = {
  SUCCESS: Check,
  FAILED: X,
  PENDING: Clock,
};

/**
 * A coloured status pill for a delivery. Falls back to a neutral tone for any
 * unknown status string so a future backend value still renders rather than
 * throwing.
 */
export function DeliveryStatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const known = status as WebhookDeliveryStatus;
  const tone =
    STATUS_TONE[known] ?? "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";
  const Icon = STATUS_ICON[known];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone,
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {status}
    </span>
  );
}

/**
 * The "last delivery" cell for an endpoint row: its status pill, or a muted
 * em-dash when nothing has been delivered yet.
 */
export function LastDeliveryCell({
  delivery,
}: {
  delivery: WebhookDelivery | null | undefined;
}) {
  if (!delivery) {
    return <span className="text-xs text-muted-foreground">No deliveries yet</span>;
  }
  return <DeliveryStatusPill status={delivery.status} />;
}

/**
 * Absolute timestamp formatting. Returns a stable, locale-formatted string;
 * callers that render this on first paint should gate behind `useHydrated()`
 * (the formatted value differs server↔client → React #418 otherwise).
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
