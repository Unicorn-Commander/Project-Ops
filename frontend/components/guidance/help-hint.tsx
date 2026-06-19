"use client";

/**
 * HelpHint — a small "?"/info icon button that reveals a tooltip with a short
 * explanation, optionally deep-linking into the Help center for the full story.
 *
 * Designed to sit beside a label, a heading, or a metric. It's quiet by
 * default (a muted glyph), themed for light/dark/vibrant, keyboard- and
 * screen-reader-accessible (the icon button is focusable and the tooltip is
 * wired via `aria-describedby` by the Tooltip primitive), and it disappears
 * entirely when the user turns tooltips off (`tooltipsEnabled === false`).
 *
 *   <HelpHint>Billable rate is what the client is charged per hour.</HelpHint>
 *
 *   <HelpHint learnMore={{ category: "billing", article: "rates" }}>
 *     Effective rate blends every line item on the invoice.
 *   </HelpHint>
 *
 * <FieldHint> is the same thing tuned to sit inline after a form-field label.
 */

import * as React from "react";
import Link from "next/link";
import { HelpCircle, Info, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGuidance, helpHref, type HelpLink } from "@/lib/guidance";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
  type TooltipSide,
} from "@/components/ui/tooltip";

export interface HelpHintProps {
  /** The explanatory text (or rich content) shown in the tooltip. */
  children: React.ReactNode;
  /** Deep-link to a Help article shown as a "Learn more" link in the bubble. */
  learnMore?: HelpLink;
  /** Which glyph to use. Default "question". */
  icon?: "question" | "info";
  /** Preferred side of the icon to show the tooltip. Default "top". */
  side?: TooltipSide;
  /** Accessible label for the icon button. Default "More information". */
  "aria-label"?: string;
  /** Extra classes for the trigger button (e.g. sizing, alignment). */
  className?: string;
  /** Icon size in px. Default 14. */
  size?: number;
  /**
   * Skip the bundled TooltipProvider — pass true when many hints live under a
   * shared <TooltipProvider> so they share one hover delay.
   */
  noProvider?: boolean;
}

export function HelpHint({
  children,
  learnMore,
  icon = "question",
  side = "top",
  className,
  size = 14,
  noProvider = false,
  ...rest
}: HelpHintProps) {
  const { tooltipsEnabled } = useGuidance();
  const ariaLabel = rest["aria-label"] ?? "More information";

  // Honour the master switch. Before hydration `tooltipsEnabled` reads its
  // default (true), so the hint renders on both server and first client render
  // — no layout shift, no #418.
  if (!tooltipsEnabled) return null;

  const Glyph = icon === "info" ? Info : HelpCircle;

  const content = (
    <Tooltip side={side}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
            className,
          )}
        >
          <Glyph style={{ width: size, height: size }} strokeWidth={2} />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-1.5">
          <div className="text-popover-foreground">{children}</div>
          {learnMore && (
            <Link
              href={helpHref(learnMore.category, learnMore.article)}
              // Tooltip content is pointer-events-none by default; re-enable
              // just the link so it's clickable, and keep it keyboard reachable.
              className="pointer-events-auto inline-flex items-center gap-0.5 font-semibold text-primary underline-offset-2 hover:underline"
            >
              {learnMore.label ?? "Learn more"}
              <ArrowUpRight className="h-3 w-3" />
            </Link>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );

  return noProvider ? content : <TooltipProvider>{content}</TooltipProvider>;
}

export interface FieldHintProps extends Omit<HelpHintProps, "className"> {
  /** Extra classes for the inline wrapper. */
  className?: string;
}

/**
 * FieldHint — a HelpHint sized + spaced to sit right after a form-field label.
 *
 *   <Label htmlFor="rate">
 *     Billable rate
 *     <FieldHint learnMore={{ category: "billing", article: "rates" }}>
 *       What the client is charged per hour for this project.
 *     </FieldHint>
 *   </Label>
 */
export function FieldHint({ className, ...props }: FieldHintProps) {
  return (
    <HelpHint
      {...props}
      className={cn("ml-1 -translate-y-px align-middle", className)}
    />
  );
}
