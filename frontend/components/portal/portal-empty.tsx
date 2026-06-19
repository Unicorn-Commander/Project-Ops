"use client";

/**
 * PortalEmpty — a warm, reassuring "nothing here yet" surface for the client
 * portal. It wraps the same tinted-icon-well language as the rest of the app
 * but sits inside a soft, full card with generous breathing room, so an empty
 * page feels intentional and calm rather than like a missing screen.
 *
 * Pass plain, friendly copy. Optionally a CTA (a link or a button node).
 */

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { iconWellClass } from "@/lib/badge-styles";

type IconWellTone = Parameters<typeof iconWellClass>[0];

export interface PortalEmptyProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  iconTone?: IconWellTone;
  title: string;
  body?: React.ReactNode;
  /** Optional CTA as an internal link. */
  ctaHref?: string;
  ctaLabel?: string;
  /** Or supply an arbitrary action node (button, etc.). Takes precedence. */
  action?: React.ReactNode;
  className?: string;
}

export function PortalEmpty({
  icon: Icon,
  iconTone = "primary",
  title,
  body,
  ctaHref,
  ctaLabel,
  action,
  className,
}: PortalEmptyProps) {
  return (
    <div
      className={cn(
        "po-card flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card px-6 py-16 text-center",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex h-14 w-14 items-center justify-center rounded-2xl",
          iconWellClass(iconTone),
        )}
      >
        <Icon className="h-7 w-7" strokeWidth={1.75} />
      </span>
      <div className="space-y-1.5">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        {body && (
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
        )}
      </div>
      {action
        ? <div className="mt-1">{action}</div>
        : ctaHref && (
            <Link
              href={ctaHref}
              className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {ctaLabel ?? "Get started"}
            </Link>
          )}
    </div>
  );
}
