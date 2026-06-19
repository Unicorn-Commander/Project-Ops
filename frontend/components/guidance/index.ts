/**
 * Guidance kit — in-app guidance primitives for Project Ops.
 *
 * Foundation layer (this folder): tooltips/hints, dismissible coachmarks, and
 * data-driven first-run onboarding. Round-2 callers (staff + client onboarding)
 * import from here and supply content; nothing here is wired into a page.
 *
 * See also:
 *   - components/ui/tooltip.tsx — the underlying Tooltip primitive
 *   - lib/guidance.ts           — the persisted store + useGuidance() hook
 */

export { HelpHint, FieldHint } from "./help-hint";
export type { HelpHintProps, FieldHintProps } from "./help-hint";

export { Coachmark } from "./coachmark";
export type { CoachmarkProps } from "./coachmark";

export {
  OnboardingChecklist,
  TourPopover,
  OnboardingDialog,
} from "./onboarding-checklist";
export type {
  OnboardingChecklistProps,
  OnboardingStep,
  TourPopoverProps,
  TourStep,
} from "./onboarding-checklist";
