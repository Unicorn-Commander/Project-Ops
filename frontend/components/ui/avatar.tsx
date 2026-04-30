import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Generic Avatar — initials in a deterministic-coloured pill.
 *
 * The colour is derived from a stable hash of the seed (typically
 * `${firstName} ${lastName}` or email), so the same person always lands
 * on the same gradient across the app — Aaron is consistently violet,
 * Shafen is consistently amber, etc. Eight buckets, picked to read
 * cleanly in both light and dark themes.
 */

const TONES = [
  "from-violet-500/20 to-fuchsia-500/20 text-violet-700 dark:text-violet-300",
  "from-amber-500/20  to-orange-500/20  text-amber-700  dark:text-amber-300",
  "from-emerald-500/20 to-teal-500/20   text-emerald-700 dark:text-emerald-300",
  "from-rose-500/20   to-pink-500/20    text-rose-700   dark:text-rose-300",
  "from-blue-500/20   to-sky-500/20     text-blue-700   dark:text-blue-300",
  "from-cyan-500/20   to-teal-500/20    text-cyan-700   dark:text-cyan-300",
  "from-indigo-500/20 to-blue-500/20    text-indigo-700 dark:text-indigo-300",
  "from-orange-500/20 to-rose-500/20    text-orange-700 dark:text-orange-300",
];

function hashSeed(seed: string): number {
  // djb2 — small, deterministic, avoids the `String.charCodeAt(0)` bias
  // that would put every "A" name into the same bucket.
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return Math.abs(hash);
}

function initialsFrom(seed: string): string {
  const trimmed = seed.trim();
  if (!trimmed) return "?";
  // If it looks like an email, take the local part.
  const local = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const parts = local.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

export interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Display name or email — used for both the initials and the gradient hash. */
  name: string;
  /** Override the auto-derived initials (e.g. when you already have them). */
  initials?: string;
  /** px — defaults to 28 (h-7 w-7). */
  size?: number;
  /** Optional ring (useful when stacked on coloured cards). */
  ring?: boolean;
}

export function Avatar({
  name,
  initials,
  size = 28,
  ring = false,
  className,
  ...props
}: AvatarProps) {
  const tone = TONES[hashSeed(name) % TONES.length];
  const text = initials ?? initialsFrom(name);
  return (
    <span
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold uppercase",
        tone,
        ring && "ring-2 ring-card",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.42)),
      }}
      {...props}
    >
      {text}
    </span>
  );
}
