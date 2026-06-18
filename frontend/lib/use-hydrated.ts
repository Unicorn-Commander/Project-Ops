/**
 * useHydrated — returns `false` on the server render AND on the very first
 * client render, then `true` after the component has mounted.
 *
 * Why: every `"use client"` page is still server-rendered by the App Router.
 * Anything whose value differs between the server render and the *first* client
 * render (localStorage-derived state, `navigator.*`, `Date.now()` / relative
 * timestamps, etc.) produces a hydration mismatch — React error #418
 * ("text content does not match" / "hydration failed"). Gating that UI behind
 * `useHydrated()` makes the server render and the first client render agree
 * (both see `false`), and the real, client-only value paints on the next tick.
 *
 *   const hydrated = useHydrated();
 *   <span>{hydrated ? `Welcome back, ${user?.firstName}` : "Welcome back"}</span>
 *
 * Prefer this over `suppressHydrationWarning` when the two renders genuinely
 * differ in *structure* or *text*: suppress only silences the warning for a
 * single text node, whereas gating keeps the trees identical.
 */
"use client";

import { useEffect, useState } from "react";

export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}
