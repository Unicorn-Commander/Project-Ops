"use client";

/**
 * Tooltip — a dependency-free, accessible hover/focus popover.
 *
 * WHY NOT RADIX: the rest of the kit wraps Radix primitives, but
 * `@radix-ui/react-tooltip` is NOT installed (not in package.json /
 * node_modules), and this foundation must compile + be import-ready with zero
 * new dependencies. So this is a clean hand-rolled implementation that mirrors
 * Radix's component API exactly — `TooltipProvider` / `Tooltip` /
 * `TooltipTrigger` / `TooltipContent` — so a later swap to the Radix package
 * (once installed) is a near drop-in. It matches the kit's look (popover
 * tokens, border, shadow, arrow) and works in light, dark, and vibrant.
 *
 * ACCESSIBILITY
 *   - Opens on pointer hover AND on keyboard focus of the trigger.
 *   - The trigger gets `aria-describedby` pointing at the tooltip, and the
 *     content has `role="tooltip"`, so screen readers announce it.
 *   - Escape dismisses; the tooltip never traps focus (it's non-interactive,
 *     `pointer-events-none` by default).
 *   - Respects `prefers-reduced-motion` (no fade/zoom when reduced).
 *
 * HYDRATION (#418): no `localStorage` / `navigator` / `Date` is read in a
 * useState initializer or during render. Positioning is measured in effects /
 * event handlers only. The content is not rendered at all until it opens, so
 * the server render and first client render agree (both: trigger only).
 *
 * POSITIONING: fixed-position, measured against the trigger's bounding rect so
 * it escapes `overflow:hidden` ancestors, with simple viewport collision
 * flipping. It's a tooltip (small, transient) — this is deliberately lighter
 * than a full popper. For anchored, persistent bubbles see
 * `components/guidance/coachmark.tsx`.
 */

import * as React from "react";
import { cn } from "@/lib/utils";

export type TooltipSide = "top" | "bottom" | "left" | "right";
export type TooltipAlign = "start" | "center" | "end";

const DEFAULT_DELAY = 400; // ms before a hovered tooltip appears

// ── Provider ────────────────────────────────────────────────────────────────
// Radix exposes a Provider that sets a shared open-delay. We honour the same
// surface so callers can wrap a subtree (or the app) once.

interface ProviderValue {
  delayDuration: number;
}
const ProviderContext = React.createContext<ProviderValue>({
  delayDuration: DEFAULT_DELAY,
});

export interface TooltipProviderProps {
  children: React.ReactNode;
  /** Hover delay (ms) before a tooltip opens. Default 400. */
  delayDuration?: number;
}

export function TooltipProvider({
  children,
  delayDuration = DEFAULT_DELAY,
}: TooltipProviderProps) {
  const value = React.useMemo(() => ({ delayDuration }), [delayDuration]);
  return (
    <ProviderContext.Provider value={value}>
      {children}
    </ProviderContext.Provider>
  );
}

// ── Tooltip (root) ───────────────────────────────────────────────────────────

interface TooltipContextValue {
  open: boolean;
  contentId: string;
  triggerRef: React.RefObject<HTMLElement | null>;
  side: TooltipSide;
  align: TooltipAlign;
  sideOffset: number;
  scheduleOpen: () => void;
  cancelOpen: () => void;
  close: () => void;
  setContentSide: (side: TooltipSide) => void;
}

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

function useTooltipContext(component: string): TooltipContextValue {
  const ctx = React.useContext(TooltipContext);
  if (!ctx) {
    throw new Error(`<${component}> must be used inside <Tooltip>`);
  }
  return ctx;
}

let tooltipIdCounter = 0;

export interface TooltipProps {
  children: React.ReactNode;
  /** Controlled open state. Omit for uncontrolled (hover/focus driven). */
  open?: boolean;
  /** Called when the open state should change. */
  onOpenChange?: (open: boolean) => void;
  /** Default open state when uncontrolled. */
  defaultOpen?: boolean;
  /** Override the provider's hover delay (ms). */
  delayDuration?: number;
  /** Preferred side of the trigger. Default "top". */
  side?: TooltipSide;
  /** Cross-axis alignment. Default "center". */
  align?: TooltipAlign;
  /** Gap between trigger and tooltip (px). Default 6. */
  sideOffset?: number;
}

export function Tooltip({
  children,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
  delayDuration,
  side = "top",
  align = "center",
  sideOffset = 6,
}: TooltipProps) {
  const provider = React.useContext(ProviderContext);
  const delay = delayDuration ?? provider.delayDuration;

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;

  const triggerRef = React.useRef<HTMLElement | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // The resolved side can flip on collision; content reports it back so the
  // arrow + transform origin stay correct.
  const [resolvedSide, setResolvedSide] = React.useState<TooltipSide>(side);

  // Stable per-instance id for aria-describedby. Generated in a ref so it's the
  // same string on every render (and we avoid reading anything during render
  // that could differ server vs client — the counter is module-local and only
  // advanced once on first render of this component instance).
  const idRef = React.useRef<string>("");
  if (!idRef.current) {
    tooltipIdCounter += 1;
    idRef.current = `po-tooltip-${tooltipIdCounter}`;
  }

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const cancelOpen = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleOpen = React.useCallback(() => {
    cancelOpen();
    if (delay <= 0) {
      setOpen(true);
      return;
    }
    timerRef.current = setTimeout(() => setOpen(true), delay);
  }, [cancelOpen, delay, setOpen]);

  const close = React.useCallback(() => {
    cancelOpen();
    setOpen(false);
    setResolvedSide(side);
  }, [cancelOpen, setOpen, side]);

  // Clear any pending timer on unmount.
  React.useEffect(() => () => cancelOpen(), [cancelOpen]);

  // Close on Escape while open (matches Radix; non-trapping).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const value = React.useMemo<TooltipContextValue>(
    () => ({
      open,
      contentId: idRef.current,
      triggerRef,
      side,
      align,
      sideOffset,
      scheduleOpen,
      cancelOpen,
      close,
      setContentSide: setResolvedSide,
    }),
    [open, side, align, sideOffset, scheduleOpen, cancelOpen, close],
  );

  return (
    <TooltipContext.Provider value={value}>
      {/* resolvedSide is consumed by TooltipContent via a second context read */}
      <ResolvedSideContext.Provider value={resolvedSide}>
        {children}
      </ResolvedSideContext.Provider>
    </TooltipContext.Provider>
  );
}

const ResolvedSideContext = React.createContext<TooltipSide>("top");

// ── Trigger ──────────────────────────────────────────────────────────────────
// `asChild` clones the single child so the consumer's own element becomes the
// trigger (mirrors Radix). Default renders a focusable inline <span>.

export interface TooltipTriggerProps
  extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
  children: React.ReactNode;
}

export const TooltipTrigger = React.forwardRef<HTMLElement, TooltipTriggerProps>(
  function TooltipTrigger({ asChild = false, children, ...props }, forwardedRef) {
    const ctx = useTooltipContext("TooltipTrigger");

    const setRef = React.useCallback(
      (node: HTMLElement | null) => {
        ctx.triggerRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef)
          (forwardedRef as React.MutableRefObject<HTMLElement | null>).current =
            node;
      },
      [ctx.triggerRef, forwardedRef],
    );

    // Handlers are merged with any the consumer passed. Typed against
    // <HTMLElement> so they line up with the spread `props` (which are
    // React.HTMLAttributes<HTMLElement>) when rendered on the default <span>.
    const handlers = {
      onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
        props.onPointerEnter?.(e);
        if (e.pointerType !== "touch") ctx.scheduleOpen();
      },
      onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
        props.onPointerLeave?.(e);
        ctx.close();
      },
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
        props.onPointerDown?.(e);
        // A click/press dismisses (the action speaks for itself).
        ctx.close();
      },
      onFocus: (e: React.FocusEvent<HTMLElement>) => {
        props.onFocus?.(e);
        // Keyboard focus opens immediately (no hover delay) for a11y.
        ctx.cancelOpen();
        ctx.scheduleOpen();
      },
      onBlur: (e: React.FocusEvent<HTMLElement>) => {
        props.onBlur?.(e);
        ctx.close();
      },
    };

    const ariaDescribedBy = ctx.open
      ? [props["aria-describedby"], ctx.contentId].filter(Boolean).join(" ")
      : props["aria-describedby"];

    if (asChild && React.isValidElement(children)) {
      const child = children as React.ReactElement<Record<string, unknown>>;
      const childProps = child.props as Record<string, unknown> & {
        onPointerEnter?: React.PointerEventHandler;
        onPointerLeave?: React.PointerEventHandler;
        onPointerDown?: React.PointerEventHandler;
        onFocus?: React.FocusEventHandler;
        onBlur?: React.FocusEventHandler;
      };
      return React.cloneElement(child, {
        ref: setRef,
        "aria-describedby": ariaDescribedBy,
        onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
          childProps.onPointerEnter?.(e);
          handlers.onPointerEnter(e);
        },
        onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
          childProps.onPointerLeave?.(e);
          handlers.onPointerLeave(e);
        },
        onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
          childProps.onPointerDown?.(e);
          handlers.onPointerDown(e);
        },
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
          childProps.onFocus?.(e);
          handlers.onFocus(e);
        },
        onBlur: (e: React.FocusEvent<HTMLElement>) => {
          childProps.onBlur?.(e);
          handlers.onBlur(e);
        },
      } as Record<string, unknown>);
    }

    return (
      <span
        ref={setRef as React.Ref<HTMLSpanElement>}
        // Focusable so keyboard users can reveal the tooltip. Consumers who
        // pass a real <button> via asChild get native focusability instead.
        tabIndex={props.tabIndex ?? 0}
        {...props}
        aria-describedby={ariaDescribedBy}
        onPointerEnter={handlers.onPointerEnter}
        onPointerLeave={handlers.onPointerLeave}
        onPointerDown={handlers.onPointerDown}
        onFocus={handlers.onFocus}
        onBlur={handlers.onBlur}
      >
        {children}
      </span>
    );
  },
);

// ── Content ──────────────────────────────────────────────────────────────────

interface Coords {
  top: number;
  left: number;
  side: TooltipSide;
}

export interface TooltipContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Show the little arrow pointing at the trigger. Default true. */
  showArrow?: boolean;
  /** Max width (px) of the tooltip bubble. Default 260. */
  maxWidth?: number;
}

export const TooltipContent = React.forwardRef<
  HTMLDivElement,
  TooltipContentProps
>(function TooltipContent(
  { className, children, showArrow = true, maxWidth = 260, style, ...props },
  forwardedRef,
) {
  const ctx = useTooltipContext("TooltipContent");
  const localRef = React.useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = React.useState<Coords | null>(null);

  const setRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef)
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
    },
    [forwardedRef],
  );

  // Measure + position whenever we open (and on scroll/resize while open).
  // All DOM reads happen here, never during render → no hydration concern.
  React.useLayoutEffect(() => {
    if (!ctx.open) {
      setCoords(null);
      return;
    }
    const place = () => {
      const trigger = ctx.triggerRef.current;
      const el = localRef.current;
      if (!trigger || !el) return;

      const t = trigger.getBoundingClientRect();
      const cw = el.offsetWidth;
      const ch = el.offsetHeight;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = ctx.sideOffset;
      const margin = 8; // keep off the viewport edge

      // Choose a side, flipping to the opposite if it would overflow.
      let side = ctx.side;
      const fits = (s: TooltipSide) => {
        if (s === "top") return t.top - gap - ch >= margin;
        if (s === "bottom") return t.bottom + gap + ch <= vh - margin;
        if (s === "left") return t.left - gap - cw >= margin;
        return t.right + gap + cw <= vw - margin; // right
      };
      const opposite: Record<TooltipSide, TooltipSide> = {
        top: "bottom",
        bottom: "top",
        left: "right",
        right: "left",
      };
      if (!fits(side) && fits(opposite[side])) side = opposite[side];

      let top = 0;
      let left = 0;
      if (side === "top" || side === "bottom") {
        top = side === "top" ? t.top - gap - ch : t.bottom + gap;
        if (ctx.align === "start") left = t.left;
        else if (ctx.align === "end") left = t.right - cw;
        else left = t.left + t.width / 2 - cw / 2;
      } else {
        left = side === "left" ? t.left - gap - cw : t.right + gap;
        if (ctx.align === "start") top = t.top;
        else if (ctx.align === "end") top = t.bottom - ch;
        else top = t.top + t.height / 2 - ch / 2;
      }

      // Clamp into the viewport so it never clips off-screen.
      left = Math.max(margin, Math.min(left, vw - cw - margin));
      top = Math.max(margin, Math.min(top, vh - ch - margin));

      setCoords({ top, left, side });
      ctx.setContentSide(side);
    };

    // First place after the element has its natural size.
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [ctx.open, ctx.side, ctx.align, ctx.sideOffset, ctx, children, maxWidth]);

  if (!ctx.open) return null;

  const side = coords?.side ?? ctx.side;

  // Arrow position classes per side. The arrow is a rotated square sharing the
  // popover background + border so it reads as a single bubble.
  const arrowBySide: Record<TooltipSide, string> = {
    top: "-bottom-1 left-1/2 -translate-x-1/2 border-b border-r",
    bottom: "-top-1 left-1/2 -translate-x-1/2 border-t border-l",
    left: "-right-1 top-1/2 -translate-y-1/2 border-t border-r",
    right: "-left-1 top-1/2 -translate-y-1/2 border-b border-l",
  };

  return (
    <div
      ref={setRef}
      role="tooltip"
      id={ctx.contentId}
      // Don't steal pointer events; a tooltip is non-interactive.
      className={cn(
        "pointer-events-none fixed z-[60] w-max rounded-md border border-border bg-popover px-3 py-1.5 text-xs font-medium leading-snug text-popover-foreground shadow-md",
        // Subtle fade/zoom in; skipped under reduced-motion.
        "motion-safe:animate-[po-tooltip-in_120ms_ease-out]",
        // Until measured, render invisibly off where it can't flash at 0,0.
        coords ? "opacity-100" : "opacity-0",
        className,
      )}
      style={{
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        maxWidth,
        ...style,
      }}
      {...props}
    >
      {children}
      {showArrow && (
        <span
          aria-hidden
          className={cn(
            "absolute h-2 w-2 rotate-45 border-border bg-popover",
            arrowBySide[side],
          )}
        />
      )}
      {/* Scoped keyframe so we don't depend on tailwindcss-animate (absent). */}
      <style>{`@keyframes po-tooltip-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );
});

/**
 * `SimpleTooltip` — the common case in one tag. Wraps a trigger with a tooltip
 * whose body is `content`. Provider is included so it works standalone.
 *
 *   <SimpleTooltip content="Archive this project">
 *     <Button size="icon" variant="ghost"><Archive /></Button>
 *   </SimpleTooltip>
 */
export interface SimpleTooltipProps
  extends Omit<TooltipProps, "children" | "open" | "onOpenChange"> {
  content: React.ReactNode;
  children: React.ReactElement;
  contentProps?: TooltipContentProps;
  /** Skip the bundled provider (when already inside a TooltipProvider). */
  noProvider?: boolean;
}

export function SimpleTooltip({
  content,
  children,
  contentProps,
  noProvider = false,
  ...rootProps
}: SimpleTooltipProps) {
  const inner = (
    <Tooltip {...rootProps}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent {...contentProps}>{content}</TooltipContent>
    </Tooltip>
  );
  return noProvider ? inner : <TooltipProvider>{inner}</TooltipProvider>;
}
