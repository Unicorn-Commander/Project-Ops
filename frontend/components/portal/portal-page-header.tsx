"use client";

/**
 * PortalPageHeader — the consistent header that opens each inner portal page
 * (Projects, Approvals, Invoices, Documents). Lighter than the dashboard hero:
 * a tinted icon well, a clear title, a one-line plain-language subtitle, and an
 * optional action on the right.
 *
 * It exists so every portal page shares the same calm, spacious masthead — the
 * hospitality cue that this is a client surface, not the dense staff app.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { iconWellClass } from "@/lib/badge-styles";

type IconWellTone = Parameters<typeof iconWellClass>[0];

export interface PortalPageHeaderProps {
  /** Lucide (or compatible) icon component for the tinted well. */
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Icon well tone. Defaults to the brand primary. */
  iconTone?: IconWellTone;
  /** Page title. */
  title: string;
  /** Plain-language one-liner under the title. */
  subtitle?: React.ReactNode;
  /** Optional right-aligned content (a count chip, an action, etc.). */
  actions?: React.ReactNode;
  className?: string;
}

export function PortalPageHeader({
  icon: Icon,
  iconTone = "primary",
  title,
  subtitle,
  actions,
  className,
}: PortalPageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3.5">
        {Icon && (
          <span
            className={cn(
              "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              iconWellClass(iconTone),
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={1.9} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-[1.75rem]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
