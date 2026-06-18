"use client";

/**
 * Renders a Help article's `HelpBlock[]` into clean, themed typography.
 *
 * Kept dumb on purpose: it takes blocks and paints them. No data fetching, no
 * hydration-sensitive reads (no Date/localStorage/navigator), so it's safe
 * inside the SSR'd "use client" Help page.
 */

import type { HelpBlock } from "@/lib/help-content";
import { Info, Lightbulb, AlertTriangle } from "lucide-react";

const NOTE_STYLES = {
  info: {
    wrap: "border-blue-500/30 bg-blue-500/5",
    icon: "text-blue-600 dark:text-blue-300",
    Icon: Info,
  },
  tip: {
    wrap: "border-emerald-500/30 bg-emerald-500/5",
    icon: "text-emerald-600 dark:text-emerald-300",
    Icon: Lightbulb,
  },
  warning: {
    wrap: "border-amber-500/40 bg-amber-500/5",
    icon: "text-amber-600 dark:text-amber-300",
    Icon: AlertTriangle,
  },
} as const;

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

export function HelpArticleBody({ blocks }: { blocks: HelpBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h":
            return (
              <h3
                key={i}
                className="pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {block.text}
              </h3>
            );
          case "p":
            return (
              <p key={i} className="text-sm leading-relaxed text-foreground/90">
                {block.text}
              </p>
            );
          case "list":
            return (
              <ul key={i} className="space-y-1.5 pl-1">
                {block.items.map((item, j) => (
                  <li
                    key={j}
                    className="flex gap-2.5 text-sm leading-relaxed text-foreground/90"
                  >
                    <span
                      aria-hidden
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={i} className="space-y-2">
                {block.items.map((item, j) => (
                  <li
                    key={j}
                    className="flex gap-3 text-sm leading-relaxed text-foreground/90"
                  >
                    <span
                      aria-hidden
                      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary"
                    >
                      {j + 1}
                    </span>
                    <span className="pt-px">{item}</span>
                  </li>
                ))}
              </ol>
            );
          case "note": {
            const s = NOTE_STYLES[block.variant];
            const NoteIcon = s.Icon;
            return (
              <div
                key={i}
                className={`flex items-start gap-2.5 rounded-lg border p-3 ${s.wrap}`}
              >
                <NoteIcon className={`mt-0.5 h-4 w-4 shrink-0 ${s.icon}`} strokeWidth={2} />
                <p className="text-[13px] leading-relaxed text-foreground/90">
                  {block.text}
                </p>
              </div>
            );
          }
          case "code":
            return (
              <div key={i} className="space-y-1.5">
                {block.caption && (
                  <div className="text-xs font-medium text-muted-foreground">
                    {block.caption}
                  </div>
                )}
                <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed">
                  <code className="font-mono text-foreground/90">{block.text}</code>
                </pre>
              </div>
            );
          case "kbd":
            return (
              <div key={i} className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
                {block.rows.map((row, j) => (
                  <div key={j} className="flex items-center justify-between gap-4 text-sm">
                    <span className="text-foreground/90">{row.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, ki) => (
                        <Kbd key={ki}>{k}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
