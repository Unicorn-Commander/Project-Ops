import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A polished, intentional "nothing here yet" surface. Renders a tinted
 * icon well, a heading, optional sub-copy, and optional CTA(s).
 *
 * Used in two ways:
 *   <EmptyState icon={FolderOpen} title="No documents" body="..." action={...} />
 *
 * The icon is given the same tinted-icon-well treatment as the dashboard
 * stat cards — it ties the empty surface visually to the rest of the app
 * instead of looking like a forgotten skeleton.
 */
export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  iconTone?:
    | "blue"
    | "amber"
    | "emerald"
    | "rose"
    | "violet"
    | "orange"
    | "primary"
    | "zinc";
  title: string;
  body?: string;
  action?: React.ReactNode;
}

const TONE_CLASSES: Record<NonNullable<EmptyStateProps["iconTone"]>, string> = {
  blue: "bg-blue-500/15 text-blue-600 dark:text-blue-300",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  rose: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  violet: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  orange: "bg-orange-500/15 text-orange-600 dark:text-orange-300",
  primary: "bg-primary/15 text-primary",
  zinc: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
};

export function EmptyState({
  icon: Icon,
  iconTone = "zinc",
  title,
  body,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border/70 px-6 py-12 text-center",
        className,
      )}
      {...props}
    >
      {Icon && (
        <div
          className={cn(
            "inline-flex h-11 w-11 items-center justify-center rounded-lg",
            TONE_CLASSES[iconTone],
          )}
        >
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      )}
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {body && (
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
            {body}
          </p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
