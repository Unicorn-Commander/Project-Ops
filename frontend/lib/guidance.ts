/**
 * Guidance store — the persisted state behind Project Ops' in-app guidance
 * layer (tooltips, hints/coachmarks, and first-run onboarding checklists).
 *
 * One namespaced localStorage key holds everything:
 *
 *   po.guidance.v1 = {
 *     tooltipsEnabled: boolean,            // master switch, default ON
 *     dismissedHints:  string[],           // ids the user has waved away
 *     onboarding:      { [key]: boolean }, // completed first-run flows
 *   }
 *
 * HYDRATION (React #418): every "use client" page is still server-rendered by
 * the App Router. If `useGuidance()` returned localStorage-derived values on
 * the first client render, that render would disagree with the server render
 * (which has no localStorage) and React would throw a hydration mismatch. So
 * the hook returns DEFAULTS until it has mounted — exactly the pattern in
 * `lib/starred.ts` and documented in `lib/use-hydrated.ts`. The real persisted
 * state loads in a mount effect, and consumers can read `hydrated` to avoid
 * flashing guidance UI before the user's real preference is known.
 *
 * Live sync: writes broadcast a same-tab CustomEvent (storage events only fire
 * across tabs) so every mounted `useGuidance()` consumer — e.g. a settings
 * toggle and a dozen `<HelpHint>`s — updates together. Cross-tab changes ride
 * the native `storage` event.
 *
 * This is intentionally local-only (a per-browser preference). There is no
 * `/guidance` backend route; do not wire one until a table exists. Mirrors the
 * "local until a backend lands" note on saved-views/starred.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

/** The single localStorage key. Bump the suffix to invalidate old shapes. */
export const GUIDANCE_KEY = "po.guidance.v1";

/** Fired same-tab on every write so live consumers re-read immediately. */
const EVENT = "po:guidance-changed";

/** Persisted shape. All fields optional on disk; normalised on read. */
export interface GuidanceState {
  /** Master switch for hints/coachmarks/tooltips. Default ON ("default on"). */
  tooltipsEnabled: boolean;
  /** Hint/coachmark ids the user has dismissed (won't show again). */
  dismissedHints: string[];
  /** Onboarding flow keys → completed. */
  onboarding: Record<string, boolean>;
}

/** The defaults the SERVER render and the FIRST client render both see. */
export const GUIDANCE_DEFAULTS: GuidanceState = {
  tooltipsEnabled: true,
  dismissedHints: [],
  onboarding: {},
};

// ──────────────────────────────────────────────────────────────────────────
// Low-level persistence (safe to call from anywhere; SSR-guarded)
// ──────────────────────────────────────────────────────────────────────────

function read(): GuidanceState {
  if (typeof window === "undefined") return { ...GUIDANCE_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(GUIDANCE_KEY);
    if (!raw) return { ...GUIDANCE_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<GuidanceState> | null;
    if (!parsed || typeof parsed !== "object") return { ...GUIDANCE_DEFAULTS };
    return {
      // Default ON: only an explicit `false` disables tooltips.
      tooltipsEnabled:
        typeof parsed.tooltipsEnabled === "boolean"
          ? parsed.tooltipsEnabled
          : GUIDANCE_DEFAULTS.tooltipsEnabled,
      dismissedHints: Array.isArray(parsed.dismissedHints)
        ? parsed.dismissedHints.filter((x): x is string => typeof x === "string")
        : [],
      onboarding:
        parsed.onboarding && typeof parsed.onboarding === "object"
          ? (parsed.onboarding as Record<string, boolean>)
          : {},
    };
  } catch {
    return { ...GUIDANCE_DEFAULTS };
  }
}

function write(next: GuidanceState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUIDANCE_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota — guidance is best-effort, never throw.
  }
  // Notify live, same-tab consumers (storage events don't fire in-tab).
  window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
}

/** Read-modify-write a single field, returning the new state. */
function update(mutate: (s: GuidanceState) => GuidanceState): GuidanceState {
  const next = mutate(read());
  write(next);
  return next;
}

// ──────────────────────────────────────────────────────────────────────────
// Imperative helpers — usable outside React (e.g. event handlers, tests)
// ──────────────────────────────────────────────────────────────────────────

export function getTooltipsEnabled(): boolean {
  return read().tooltipsEnabled;
}

export function setTooltipsEnabled(enabled: boolean): void {
  update((s) => ({ ...s, tooltipsEnabled: enabled }));
}

export function isHintDismissed(id: string): boolean {
  return read().dismissedHints.includes(id);
}

export function dismissHint(id: string): void {
  update((s) =>
    s.dismissedHints.includes(id)
      ? s
      : { ...s, dismissedHints: [...s.dismissedHints, id] },
  );
}

/** Un-dismiss a single hint (used by "reset guidance" / re-show flows). */
export function restoreHint(id: string): void {
  update((s) => ({
    ...s,
    dismissedHints: s.dismissedHints.filter((x) => x !== id),
  }));
}

export function isOnboardingDone(key: string): boolean {
  return read().onboarding[key] === true;
}

export function completeOnboarding(key: string): void {
  update((s) => ({ ...s, onboarding: { ...s.onboarding, [key]: true } }));
}

export function resetOnboarding(key: string): void {
  update((s) => {
    if (!(key in s.onboarding)) return s;
    const onboarding = { ...s.onboarding };
    delete onboarding[key];
    return { ...s, onboarding };
  });
}

/** Wipe ALL guidance state (dev / "reset all tips" affordance). */
export function resetAllGuidance(): void {
  write({ ...GUIDANCE_DEFAULTS });
}

// ──────────────────────────────────────────────────────────────────────────
// React hook — live, hydration-safe view of the store
// ──────────────────────────────────────────────────────────────────────────

export interface UseGuidance {
  /**
   * `false` on the server render and the first client render, then `true`.
   * Gate any UI whose presence depends on persisted state on this to avoid a
   * hydration mismatch / a flash of the wrong guidance state.
   */
  hydrated: boolean;

  /** Master switch. Reads as the default (ON) until `hydrated`. */
  tooltipsEnabled: boolean;
  setTooltipsEnabled: (enabled: boolean) => void;

  /** True only after hydration AND if the id was previously dismissed. */
  isHintDismissed: (id: string) => boolean;
  dismissHint: (id: string) => void;
  restoreHint: (id: string) => void;

  /** True only after hydration AND if the flow was completed. */
  isOnboardingDone: (key: string) => boolean;
  completeOnboarding: (key: string) => void;
  resetOnboarding: (key: string) => void;

  resetAll: () => void;
}

export function useGuidance(): UseGuidance {
  // Start from defaults so server + first client render agree (#418). The
  // mount effect below swaps in the real persisted state on the next tick.
  const [state, setState] = useState<GuidanceState>(() => ({
    ...GUIDANCE_DEFAULTS,
  }));
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(read());
    setHydrated(true);

    const onChange = (e: Event) => {
      const ce = e as CustomEvent<GuidanceState>;
      // Same-tab CustomEvent carries the fresh state; cross-tab storage event
      // does not, so re-read from disk in that case.
      if (e.type === EVENT && ce.detail) {
        setState(ce.detail);
        return;
      }
      const se = e as StorageEvent;
      if (se.key === GUIDANCE_KEY || se.key === null) {
        setState(read());
      }
    };

    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  // Stable callbacks. Each writes through the imperative helper (which
  // broadcasts), and the listener above folds the new state back into React —
  // so every mounted consumer stays in lockstep.
  const setEnabled = useCallback((enabled: boolean) => {
    setTooltipsEnabled(enabled);
  }, []);
  const dismiss = useCallback((id: string) => dismissHint(id), []);
  const restore = useCallback((id: string) => restoreHint(id), []);
  const complete = useCallback((key: string) => completeOnboarding(key), []);
  const reset = useCallback((key: string) => resetOnboarding(key), []);
  const resetAll = useCallback(() => resetAllGuidance(), []);

  // Before hydration, report "not dismissed" / "not done" so guidance shows by
  // default and the trees match the server. After hydration these read live.
  const hintDismissed = useCallback(
    (id: string) => (hydrated ? state.dismissedHints.includes(id) : false),
    [hydrated, state.dismissedHints],
  );
  const onboardingDone = useCallback(
    (key: string) => (hydrated ? state.onboarding[key] === true : false),
    [hydrated, state.onboarding],
  );

  return {
    hydrated,
    tooltipsEnabled: state.tooltipsEnabled,
    setTooltipsEnabled: setEnabled,
    isHintDismissed: hintDismissed,
    dismissHint: dismiss,
    restoreHint: restore,
    isOnboardingDone: onboardingDone,
    completeOnboarding: complete,
    resetOnboarding: reset,
    resetAll,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Help deep-link helper — keeps the `/dashboard/help?c=&a=` shape in one place
// ──────────────────────────────────────────────────────────────────────────

/** The Help center route guidance components deep-link into. */
export const HELP_ROUTE = "/dashboard/help";

/**
 * Build a Help-center deep link. The Help center reads `?c=<categoryId>` to
 * select a topic and `?a=<articleId>` to open a specific article
 * (see components/help/help-center.tsx).
 */
export function helpHref(category?: string, article?: string): string {
  const params = new URLSearchParams();
  if (category) params.set("c", category);
  if (article) params.set("a", article);
  const qs = params.toString();
  return qs ? `${HELP_ROUTE}?${qs}` : HELP_ROUTE;
}

/** Convenience type for a Help deep-link target on guidance components. */
export interface HelpLink {
  /** Help category id (`?c=`). */
  category?: string;
  /** Help article id (`?a=`). */
  article?: string;
  /** Link label (defaults to "Learn more"). */
  label?: string;
}
