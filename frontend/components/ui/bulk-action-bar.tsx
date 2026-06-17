"use client";

/**
 * Floating bulk-action bar — fixed to the bottom of the viewport when
 * a list page has at least one row selected. Driven entirely by props
 * so any list (projects/tasks/contacts/documents/users) can mount it.
 *
 * Actions are passed as a children-of-array; the bar handles the
 * "N selected · Clear" shell and basic responsive layout.
 *
 * Until backend bulk endpoints land we run N parallel single-entity
 * requests (`Promise.allSettled`) per action. The progress overlay
 * during that run lives in the parent — see useBulkRunner below.
 */

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { X, Loader2 } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  entityLabel: string;
  onClear: () => void;
  children: React.ReactNode;
}

export function BulkActionBar({
  selectedCount,
  entityLabel,
  onClear,
  children,
}: BulkActionBarProps) {
  // Escape clears the current selection (and so dismisses the bar) — a
  // standard "get me out" affordance for keyboard users. Bound only while
  // a selection exists. Declared before the early return to satisfy the
  // rules of hooks.
  useEffect(() => {
    if (selectedCount === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedCount, onClear]);

  if (selectedCount === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
      <div className="flex items-center gap-3 rounded-lg border border-primary/40 bg-card/95 backdrop-blur shadow-xl px-4 py-2.5">
        <div className="flex items-center gap-2 pr-3 border-r border-border">
          <span className="inline-flex items-center justify-center h-6 min-w-[1.5rem] rounded-full bg-primary text-primary-foreground text-xs font-semibold px-1.5">
            {selectedCount}
          </span>
          <span className="text-sm font-medium text-foreground">
            {entityLabel}
            {selectedCount === 1 ? "" : "s"} selected
          </span>
        </div>
        <div className="flex items-center gap-1.5">{children}</div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="ml-1 h-8 text-xs"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      </div>
    </div>
  );
}

/**
 * Hook: runs `op` against every id in parallel and toasts the
 * aggregate result. Returns a callable + a `pending` boolean so the
 * caller can show a spinner overlay or disable the trigger.
 *
 *   const { run, pending } = useBulkRunner({ op: deleteProject, label: "Delete" });
 *   <Button onClick={() => run([...selectedIds])}>Delete</Button>
 */
export function useBulkRunner<T = void>({
  op,
  label,
  successMessage,
  onAfter,
}: {
  op: (id: string) => Promise<T>;
  label: string;
  /** Override the default "${ok} of ${total} ${label}d" toast title. */
  successMessage?: (ok: number, total: number) => string;
  /** Always called after the run, regardless of success/failure. */
  onAfter?: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setPending(true);
      try {
        const results = await Promise.allSettled(ids.map((id) => op(id)));
        const ok = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.length - ok;
        if (failed === 0) {
          toast({
            title: successMessage ? successMessage(ok, ids.length) : `${label} complete`,
            description: `${ok} of ${ids.length} done.`,
          });
        } else if (ok === 0) {
          toast({
            title: `${label} failed`,
            description: `0 of ${ids.length} succeeded. Check permissions or refresh.`,
            variant: "destructive",
          });
        } else {
          toast({
            title: `${label} partial`,
            description: `${ok} of ${ids.length} succeeded; ${failed} failed.`,
            variant: "destructive",
          });
        }
      } finally {
        await onAfter?.();
        setPending(false);
      }
    },
    [op, label, successMessage, onAfter, toast],
  );

  return { run, pending };
}

/**
 * Tiny helper for the "do the thing now" buttons inside the bar — a
 * compact secondary button with a spinner during run.
 */
export function BulkActionButton({
  pending,
  onClick,
  disabled,
  icon: Icon,
  children,
  destructive = false,
}: {
  pending?: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
  destructive?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending || disabled}
      className={`h-8 text-xs ${
        destructive
          ? "border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
          : ""
      }`}
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
      ) : (
        <Icon className="h-3.5 w-3.5 mr-1" strokeWidth={1.75} />
      )}
      {children}
    </Button>
  );
}
