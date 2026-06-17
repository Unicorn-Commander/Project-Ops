import { cn } from "@/lib/utils";

/**
 * Subtle pulsing placeholder that respects the theme. Use to mark out the
 * shape of content that hasn't loaded yet — same dimensions as the real
 * thing so the layout doesn't shift on hydration.
 *
 * The animation runs slower than Tailwind's default `animate-pulse` (1.6s
 * vs 2s) and uses a softer foreground tint so it reads as ambient rather
 * than urgent. Avoid `Skeleton` for indeterminate-progress UI — use a
 * spinner there. This is for "page loading, here's what's coming".
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        // Pulse is purely decorative — disable it for reduced-motion users
        // (the placeholder block still reserves layout, just without the
        // breathing animation).
        "animate-pulse motion-reduce:animate-none rounded-md bg-foreground/[0.06] dark:bg-foreground/[0.08]",
        className,
      )}
      style={{ animationDuration: "1.6s" }}
      {...props}
    />
  );
}

/** Common shorthand: a stack of N text lines with realistic widths. */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  // Final line is narrower so it doesn't read as a perfect block.
  const widths = ["w-full", "w-[92%]", "w-[68%]", "w-[80%]", "w-[55%]"];
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-3",
            widths[i % widths.length],
            i === lines - 1 && "w-[55%]",
          )}
        />
      ))}
    </div>
  );
}
