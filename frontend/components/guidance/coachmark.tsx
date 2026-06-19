"use client";

/**
 * Coachmark — a dismissible "did you know?" tip bubble that appears once and
 * stays gone after the user closes it.
 *
 * Two anchoring modes:
 *   - INLINE (default): renders in normal flow where you place it. Use this to
 *     point at a section ("This board is yours — drag cards to update status").
 *   - ANCHORED (`anchorRef`): floats next to a target element you pass a ref
 *     for, with a small arrow. Use this to call out a specific control.
 *
 * Persistence + the master switch both go through `lib/guidance`:
 *   - hidden forever once dismissed (`dismissHint(id)`),
 *   - hidden entirely when the user turns tooltips off,
 *   - hidden on the server + first client render until hydrated, so a
 *     coachmark the user already dismissed never flashes (#418-safe).
 *
 *   <Coachmark
 *     id="board.drag-to-update"
 *     title="Drag to update status"
 *     body="Move a card between columns to change its status — no menu needed."
 *   />
 */

import * as React from "react";
import Link from "next/link";
import { X, Lightbulb, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGuidance, helpHref, type HelpLink } from "@/lib/guidance";
import type { TooltipSide } from "@/components/ui/tooltip";

export interface CoachmarkProps {
  /** Stable id — persists the dismissal. Namespace it, e.g. "board.intro". */
  id: string;
  /** Bold one-liner. */
  title: React.ReactNode;
  /** Supporting copy. */
  body?: React.ReactNode;
  /**
   * When set, the coachmark floats anchored to this element instead of
   * rendering inline. The element should be mounted before the coachmark.
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
  /** Side to anchor on (anchored mode only). Default "bottom". */
  placement?: TooltipSide;
  /** Optional Help deep-link rendered as a footer action. */
  learnMore?: HelpLink;
  /** Optional extra action button (e.g. "Take the tour"). */
  action?: { label: string; onClick: () => void };
  /** Called after the user dismisses (in addition to persisting it). */
  onDismiss?: () => void;
  /** Extra classes for the bubble. */
  className?: string;
}

export function Coachmark({
  id,
  title,
  body,
  anchorRef,
  placement = "bottom",
  learnMore,
  action,
  onDismiss,
  className,
}: CoachmarkProps) {
  const { hydrated, tooltipsEnabled, isHintDismissed, dismissHint } =
    useGuidance();

  // Anchored position, measured in an effect (never during render).
  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = React.useState<{
    top: number;
    left: number;
  } | null>(null);

  const dismissed = isHintDismissed(id);
  // Only render once hydrated so a previously-dismissed mark never flashes.
  const visible = hydrated && tooltipsEnabled && !dismissed;

  React.useLayoutEffect(() => {
    if (!visible || !anchorRef) return;
    const place = () => {
      const anchor = anchorRef.current;
      const el = bubbleRef.current;
      if (!anchor || !el) return;
      const a = anchor.getBoundingClientRect();
      const bw = el.offsetWidth;
      const bh = el.offsetHeight;
      const gap = 10;
      const margin = 8;
      let top = 0;
      let left = 0;
      if (placement === "top") {
        top = a.top - gap - bh;
        left = a.left + a.width / 2 - bw / 2;
      } else if (placement === "bottom") {
        top = a.bottom + gap;
        left = a.left + a.width / 2 - bw / 2;
      } else if (placement === "left") {
        top = a.top + a.height / 2 - bh / 2;
        left = a.left - gap - bw;
      } else {
        top = a.top + a.height / 2 - bh / 2;
        left = a.right + gap;
      }
      left = Math.max(
        margin,
        Math.min(left, window.innerWidth - bw - margin),
      );
      top = Math.max(margin, Math.min(top, window.innerHeight - bh - margin));
      setCoords({ top, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [visible, anchorRef, placement]);

  if (!visible) return null;

  function handleDismiss() {
    dismissHint(id);
    onDismiss?.();
  }

  const anchored = Boolean(anchorRef);

  // Arrow position for anchored mode (points back at the target).
  const arrowBySide: Record<TooltipSide, string> = {
    top: "-bottom-1.5 left-1/2 -translate-x-1/2 border-b border-r",
    bottom: "-top-1.5 left-1/2 -translate-x-1/2 border-t border-l",
    left: "-right-1.5 top-1/2 -translate-y-1/2 border-t border-r",
    right: "-left-1.5 top-1/2 -translate-y-1/2 border-b border-l",
  };

  const bubble = (
    <div
      ref={bubbleRef}
      role="status"
      className={cn(
        "relative w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-border bg-popover p-3.5 text-popover-foreground shadow-lg",
        "motion-safe:animate-[po-coachmark-in_160ms_ease-out]",
        anchored && "fixed z-[60]",
        // While measuring an anchored bubble, keep it invisible to avoid a
        // flash at the top-left before coords land.
        anchored && !coords && "opacity-0",
        className,
      )}
      style={
        anchored
          ? { top: coords?.top ?? -9999, left: coords?.left ?? -9999 }
          : undefined
      }
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-300">
          <Lightbulb className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="pr-5 text-sm font-semibold leading-snug text-foreground">
            {title}
          </p>
          {body && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {body}
            </p>
          )}
          {(learnMore || action) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-3">
              {action && (
                <button
                  type="button"
                  onClick={action.onClick}
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  {action.label}
                </button>
              )}
              {learnMore && (
                <Link
                  href={helpHref(learnMore.category, learnMore.article)}
                  className="inline-flex items-center gap-0.5 text-sm font-semibold text-primary hover:underline"
                >
                  {learnMore.label ?? "Learn more"}
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss tip"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {anchored && (
        <span
          aria-hidden
          className={cn(
            "absolute h-3 w-3 rotate-45 border-border bg-popover",
            arrowBySide[placement],
          )}
        />
      )}

      <style>{`@keyframes po-coachmark-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );

  return bubble;
}
