import * as React from "react"
import { cn } from "@/lib/utils"

// Card surface — combines a soft outer shadow (works in light mode) with
// a 1px top inner-highlight ring rendered via a ::before pseudo (visible in
// dark mode where black-on-black shadows disappear). The result is that
// cards lift in both themes without any per-theme overrides per consumer.
//
// Accessibility: a Card used as a navigation target (an `onClick` is passed,
// e.g. the dashboard stat cards and the status-filter cards) is silently
// promoted to a real button — `role="button"`, keyboard focusable, a
// focus-visible ring, and Enter/Space activation — unless the consumer has
// already supplied its own `role`/`tabIndex`. This makes every clickable Card
// keyboard-operable without churn at each call site. A non-interactive Card
// (no `onClick`) is untouched.
const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, onClick, onKeyDown, role, tabIndex, ...props }, ref) => {
  const isInteractive = typeof onClick === "function" && role === undefined;
  return (
    <div
      ref={ref}
      onClick={onClick}
      role={isInteractive ? "button" : role}
      tabIndex={isInteractive ? (tabIndex ?? 0) : tabIndex}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (isInteractive && !e.defaultPrevented && (e.key === "Enter" || e.key === " ")) {
          // Space would otherwise scroll the page; Enter/Space should activate.
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).click();
        }
      }}
      className={cn(
        // `po-card` is a semantic hook used by the print stylesheet (and any
        // other surface-level rules that need to target every Card without
        // depending on Tailwind class spelling). v1.6.58.
        "po-card relative rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        "before:pointer-events-none before:absolute before:inset-0 before:rounded-xl",
        "before:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] dark:before:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]",
        // Visible keyboard focus ring only when the card is interactive.
        isInteractive &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    />
  );
})
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props}
  />
))
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }