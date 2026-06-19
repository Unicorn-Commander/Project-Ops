/**
 * Onboarding — first-run onboarding surfaces for Project Ops, built on the
 * guidance kit (`components/guidance`). This folder owns the *content* and
 * *wiring* (which steps, which copy, where they deep-link); the kit owns the
 * generic, reusable primitives and the persisted store.
 */

export {
  StaffOnboarding,
  GettingStartedButton,
  STAFF_CHECKLIST_KEY,
  STAFF_TOUR_KEY,
} from "./staff-onboarding";
export type {
  StaffOnboardingProps,
  GettingStartedButtonProps,
} from "./staff-onboarding";
