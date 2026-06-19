"use client";

/**
 * StaffOnboarding — the first-run onboarding surface for staff (ADMIN /
 * MANAGER / STAFF) on the dashboard home.
 *
 * It composes the guidance kit (it does NOT reimplement any of it):
 *   - <TourPopover autoStart>     a 3-slide "welcome" dialog the very first time
 *   - <OnboardingChecklist>       a dismissible "get set up" checklist card
 *   - <GettingStartedButton>      a subtle affordance to re-open the checklist
 *                                 after it's been dismissed (lives on the page,
 *                                 NOT in the nav, per the brief)
 *
 * Persistence is entirely the kit's: the checklist + tour each own a
 * `storageKey` in the `po.guidance.v1` store, and the re-open button clears the
 * checklist's key via `resetOnboarding`. Nothing here touches localStorage
 * directly — and there are no `localStorage` / `new Date()` reads in a render
 * path or a useState initializer (React #418), so this is SSR/hydration-safe.
 *
 * Steps deep-link to REAL routes, and the checklist marks a step done from a
 * real signal where it's cheap (e.g. "has projects" from data the dashboard
 * already loaded). Steps that would need an extra fetch to verify are left as
 * plain links — honest over clever.
 */

import * as React from "react";
import { Sparkles } from "lucide-react";
import {
  OnboardingChecklist,
  TourPopover,
  type OnboardingStep,
  type TourStep,
} from "@/components/guidance";
import { useGuidance } from "@/lib/guidance";
import { cn } from "@/lib/utils";

/** Persisted keys for the two first-run flows (namespaced under the kit). */
export const STAFF_CHECKLIST_KEY = "staff.first-run";
export const STAFF_TOUR_KEY = "staff.welcome-tour";

/**
 * The 3-slide welcome tour. Plain content — the kit renders + persists it.
 * Shown once, automatically, on a staff member's first visit to the dashboard.
 */
const WELCOME_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to Project Ops",
    body: "Your workspace for planning work, tracking time, and billing clients — projects, tasks, the schedule, and your CRM all live in one place.",
  },
  {
    title: "Three views of the same work",
    body: "See your projects as a list, drag tasks across the Kanban board, or lay everything out on the master schedule. Pick whichever fits the moment.",
  },
  {
    title: "Find anything fast",
    body: "Press ⌘K (Ctrl K on Windows / Linux) anywhere to jump to a project, task, or contact — or run a quick action like “New project”. The Help center is always a click away if you get stuck.",
  },
];

export interface StaffOnboardingProps {
  /**
   * Whether the workspace already has at least one project. Drives the
   * "Create your first project" step's done state from data the dashboard
   * already loaded — no extra fetch.
   */
  hasProjects?: boolean;
  /**
   * Whether the current user already has at least one task assigned. Marks the
   * "Add a task" step done when known; left undefined → shown as a to-do link.
   */
  hasTasks?: boolean;
  /** Opens the dashboard's Create Project modal (the checklist's first step). */
  onCreateProject?: () => void;
  className?: string;
}

/**
 * The first-run checklist + the auto-start welcome tour. Render once on the
 * dashboard home. Both pieces self-hide once completed/dismissed (the kit gates
 * them on `hydrated` + the master tooltips switch), so this returns its own
 * nulls — callers don't gate it.
 */
export function StaffOnboarding({
  hasProjects,
  hasTasks,
  onCreateProject,
  className,
}: StaffOnboardingProps) {
  const steps: OnboardingStep[] = [
    {
      id: "create-project",
      label: "Create your first project",
      description: "A project groups its tasks, documents, time, and billing.",
      // Prefer opening the modal in-place; fall back to the Projects route.
      onClick: onCreateProject,
      href: onCreateProject ? undefined : "/dashboard/projects",
      done: hasProjects,
    },
    {
      id: "add-task",
      label: "Add a task",
      description: "Break the work down — set a status, priority, and assignee.",
      href: "/dashboard/my-tasks",
      done: hasTasks,
    },
    {
      id: "command-palette",
      label: "Try the ⌘K command palette",
      description: "Jump to anything or run a quick action from one keystroke.",
      href: "/dashboard/help?c=getting-started&a=command-palette",
    },
    {
      id: "custom-fields",
      label: "Set up custom fields",
      description: "Capture your own attributes on tasks and projects (ADMIN).",
      href: "/dashboard/settings/custom-fields",
    },
    {
      id: "explore-help",
      label: "Explore the Help center",
      description: "Short, honest articles for every feature in the app.",
      href: "/dashboard/help",
    },
  ];

  return (
    <>
      <TourPopover storageKey={STAFF_TOUR_KEY} steps={WELCOME_TOUR_STEPS} autoStart />
      <OnboardingChecklist
        storageKey={STAFF_CHECKLIST_KEY}
        title="Welcome to Project Ops — let's get you set up"
        subtitle="A few quick steps to find your way around. You can skip anytime."
        steps={steps}
        className={className}
      />
    </>
  );
}

export interface GettingStartedButtonProps {
  className?: string;
}

/**
 * GettingStartedButton — a subtle "Getting started" affordance that re-opens
 * the staff checklist after it's been dismissed.
 *
 * It clears the checklist's completion flag (`resetOnboarding`) so the card
 * comes back on the same page, and it self-hides while the checklist is already
 * showing (no point offering to re-open what's open) or while tooltips are off.
 * Gated on `hydrated` so it never flashes against the persisted state (#418).
 */
export function GettingStartedButton({ className }: GettingStartedButtonProps) {
  const { hydrated, tooltipsEnabled, isOnboardingDone, resetOnboarding } =
    useGuidance();

  // Only useful once the checklist has been completed/dismissed; hidden while
  // it's still on screen or while guidance is switched off entirely.
  if (!hydrated || !tooltipsEnabled || !isOnboardingDone(STAFF_CHECKLIST_KEY)) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => resetOnboarding(STAFF_CHECKLIST_KEY)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
      Getting started
    </button>
  );
}
