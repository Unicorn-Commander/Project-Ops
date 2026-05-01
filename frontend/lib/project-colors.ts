/**
 * Per-project colour tagging — Hive/Asana-style. Each project gets a
 * deterministic hue from a 10-colour palette so cards belonging to the
 * same project read as a group and the kanban / project list / dashboard
 * carry visual splash from the data, not just the chrome.
 *
 * Deterministic by `id` so the same project always shows the same colour
 * across users + sessions. No DB migration required — the colour is
 * derived, not stored.
 *
 * If we later want operator-controlled colours, add a `color` column to
 * the Project model and prefer it when set, falling back to this hash.
 *
 * v1.6.18 added `cardWash` (Hive-style full-card background tint, very
 * faint so text stays legible) and `solidBg`/`solidText` (full-saturated
 * pill for status-style badges where Hive uses solid blocks).
 */

export type ProjectColor =
  | "indigo"
  | "rose"
  | "emerald"
  | "amber"
  | "violet"
  | "cyan"
  | "pink"
  | "orange"
  | "lime"
  | "sky";

const PALETTE: ProjectColor[] = [
  "indigo",
  "rose",
  "emerald",
  "amber",
  "violet",
  "cyan",
  "pink",
  "orange",
  "lime",
  "sky",
];

// djb2 hash → palette bucket. Same algo as the Avatar primitive (so the
// "same key → same colour" intuition is consistent across the UI).
function djb2(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return Math.abs(hash);
}

export function projectColor(id: string | undefined | null): ProjectColor {
  if (!id) return "indigo";
  return PALETTE[djb2(id) % PALETTE.length];
}

// Per-colour Tailwind class strings. These are explicit (rather than
// composed via template literals) so Tailwind's JIT picks them up at
// build time.

export interface ProjectColorClasses {
  /** A 4px solid left stripe (kanban card / list row indicator). */
  borderLeft: string;
  /** A subtle tinted background — for the project number badge pill. */
  badgeBg: string;
  /** Text colour matching the hue, dark-mode-aware. */
  badgeText: string;
  /** A solid full-saturation dot — for compact lists / inline tags. */
  dot: string;
  /** Very faint full-card background wash (Hive-style row tinting). */
  cardWash: string;
  /** Solid saturated background for full-fill pills (status-block style). */
  solidBg: string;
  /** White / near-white text for use on solid backgrounds. */
  solidText: string;
}

const CLASSES: Record<ProjectColor, ProjectColorClasses> = {
  indigo: {
    borderLeft: "border-l-indigo-500 dark:border-l-indigo-400",
    badgeBg: "bg-indigo-500/10 dark:bg-indigo-400/15",
    badgeText: "text-indigo-700 dark:text-indigo-300",
    dot: "bg-indigo-500 dark:bg-indigo-400",
    cardWash: "bg-indigo-500/[0.04] dark:bg-indigo-400/[0.07]",
    solidBg: "bg-indigo-500 dark:bg-indigo-500",
    solidText: "text-white",
  },
  rose: {
    borderLeft: "border-l-rose-500 dark:border-l-rose-400",
    badgeBg: "bg-rose-500/10 dark:bg-rose-400/15",
    badgeText: "text-rose-700 dark:text-rose-300",
    dot: "bg-rose-500 dark:bg-rose-400",
    cardWash: "bg-rose-500/[0.04] dark:bg-rose-400/[0.07]",
    solidBg: "bg-rose-500 dark:bg-rose-500",
    solidText: "text-white",
  },
  emerald: {
    borderLeft: "border-l-emerald-500 dark:border-l-emerald-400",
    badgeBg: "bg-emerald-500/10 dark:bg-emerald-400/15",
    badgeText: "text-emerald-700 dark:text-emerald-300",
    dot: "bg-emerald-500 dark:bg-emerald-400",
    cardWash: "bg-emerald-500/[0.04] dark:bg-emerald-400/[0.07]",
    solidBg: "bg-emerald-500 dark:bg-emerald-500",
    solidText: "text-white",
  },
  amber: {
    borderLeft: "border-l-amber-500 dark:border-l-amber-400",
    badgeBg: "bg-amber-500/15 dark:bg-amber-400/15",
    badgeText: "text-amber-700 dark:text-amber-300",
    dot: "bg-amber-500 dark:bg-amber-400",
    cardWash: "bg-amber-500/[0.05] dark:bg-amber-400/[0.07]",
    solidBg: "bg-amber-500 dark:bg-amber-500",
    solidText: "text-white",
  },
  violet: {
    borderLeft: "border-l-violet-500 dark:border-l-violet-400",
    badgeBg: "bg-violet-500/10 dark:bg-violet-400/15",
    badgeText: "text-violet-700 dark:text-violet-300",
    dot: "bg-violet-500 dark:bg-violet-400",
    cardWash: "bg-violet-500/[0.04] dark:bg-violet-400/[0.07]",
    solidBg: "bg-violet-500 dark:bg-violet-500",
    solidText: "text-white",
  },
  cyan: {
    borderLeft: "border-l-cyan-500 dark:border-l-cyan-400",
    badgeBg: "bg-cyan-500/10 dark:bg-cyan-400/15",
    badgeText: "text-cyan-700 dark:text-cyan-300",
    dot: "bg-cyan-500 dark:bg-cyan-400",
    cardWash: "bg-cyan-500/[0.04] dark:bg-cyan-400/[0.07]",
    solidBg: "bg-cyan-500 dark:bg-cyan-500",
    solidText: "text-white",
  },
  pink: {
    borderLeft: "border-l-pink-500 dark:border-l-pink-400",
    badgeBg: "bg-pink-500/10 dark:bg-pink-400/15",
    badgeText: "text-pink-700 dark:text-pink-300",
    dot: "bg-pink-500 dark:bg-pink-400",
    cardWash: "bg-pink-500/[0.04] dark:bg-pink-400/[0.07]",
    solidBg: "bg-pink-500 dark:bg-pink-500",
    solidText: "text-white",
  },
  orange: {
    borderLeft: "border-l-orange-500 dark:border-l-orange-400",
    badgeBg: "bg-orange-500/10 dark:bg-orange-400/15",
    badgeText: "text-orange-700 dark:text-orange-300",
    dot: "bg-orange-500 dark:bg-orange-400",
    cardWash: "bg-orange-500/[0.04] dark:bg-orange-400/[0.07]",
    solidBg: "bg-orange-500 dark:bg-orange-500",
    solidText: "text-white",
  },
  lime: {
    borderLeft: "border-l-lime-500 dark:border-l-lime-400",
    badgeBg: "bg-lime-500/15 dark:bg-lime-400/15",
    badgeText: "text-lime-700 dark:text-lime-300",
    dot: "bg-lime-500 dark:bg-lime-400",
    cardWash: "bg-lime-500/[0.05] dark:bg-lime-400/[0.07]",
    solidBg: "bg-lime-600 dark:bg-lime-600",
    solidText: "text-white",
  },
  sky: {
    borderLeft: "border-l-sky-500 dark:border-l-sky-400",
    badgeBg: "bg-sky-500/10 dark:bg-sky-400/15",
    badgeText: "text-sky-700 dark:text-sky-300",
    dot: "bg-sky-500 dark:bg-sky-400",
    cardWash: "bg-sky-500/[0.04] dark:bg-sky-400/[0.07]",
    solidBg: "bg-sky-500 dark:bg-sky-500",
    solidText: "text-white",
  },
};

export function projectColorClasses(id: string | undefined | null): ProjectColorClasses {
  return CLASSES[projectColor(id)];
}
