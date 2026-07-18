"use client";

import { useEffect, useState } from "react";

/**
 * RotatingHeadline — picks one of the headlines below at random on every page
 * load, so the hero feels alive without a rebuild.
 *
 * Hydration-safe by construction: `pick` starts `null`, which the server render
 * AND the first client render both see — so the markup matches (React #418 is
 * avoided) and the H1 renders invisibly (opacity 0) with the first headline as
 * its SEO/no-random fallback text. A mount effect then chooses a random index
 * and the chosen headline fades in. Per this repo's hard-won rule we never read
 * `Math.random()` in a `useState` initializer or during render — only in the
 * effect. See lib/use-hydrated.ts for the why.
 *
 * Each entry is [lead, accent]: `accent` gets the violet→rose→amber gradient
 * treatment, matching the rest of the brand. Keep `lead` ending in a space.
 */
const HEADLINES: ReadonlyArray<readonly [string, string]> = [
  ["Turn conversations into ", "completed work."],
  ["Where “we’ll circle back” ", "actually happens."],
  ["Your meetings talk. Project-Ops ", "makes them ship."],
  ["Project work, ", "delivered without the drama."],
  ["The status update ", "writes itself."],
  ["Assign it to a human, an agent, ", "or both."],
  ["Every task remembers ", "why it exists."],
  ["From “someone should” to ", "“someone did.”"],
  ["Meetings in. ", "Momentum out."],
  ["The operating system for teams made of ", "people and AI."],
  ["Context that survives ", "the handoff."],
  ["Chase the work, ", "not the status."],
  ["Decisions go in. ", "Delivery comes out."],
  ["Stop retyping action items ", "like it’s 2009."],
  ["The plan, the people, ", "and the receipts."],
];

export function RotatingHeadline() {
  const [pick, setPick] = useState<number | null>(null);

  useEffect(() => {
    setPick(Math.floor(Math.random() * HEADLINES.length));
  }, []);

  const [lead, accent] = HEADLINES[pick ?? 0];

  return (
    <h1
      className="mt-7 text-balance text-5xl font-semibold leading-[1.03] tracking-tight transition-opacity duration-500 sm:text-6xl md:text-[76px]"
      style={{ opacity: pick === null ? 0 : 1 }}
    >
      {lead}
      <span className="bg-gradient-to-br from-violet-500 via-rose-500 to-amber-500 bg-clip-text text-transparent">
        {accent}
      </span>
    </h1>
  );
}
