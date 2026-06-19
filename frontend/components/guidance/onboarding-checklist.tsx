"use client";

/**
 * OnboardingChecklist — a data-driven, dismissible first-run checklist card.
 *
 * Pass it `steps` and a `storageKey`; it renders a progress bar, each step as
 * a row (with an optional deep link), and "Skip"/"Done" controls. Completion
 * (whether by clicking Done or completing every step) is persisted via
 * `completeOnboarding(storageKey)`, so the card never returns once finished.
 *
 * Deliberately GENERIC: the staff onboarding and the client-portal onboarding
 * (built next) just pass different `steps`/copy — no fork of this component.
 *
 *   <OnboardingChecklist
 *     storageKey="staff.first-run"
 *     title="Get set up"
 *     steps={[
 *       { id: "profile",   label: "Complete your profile", href: "/dashboard/settings", done: hasProfile },
 *       { id: "project",   label: "Create your first project", href: "/dashboard/projects" },
 *       { id: "invite",    label: "Invite a teammate", href: "/dashboard/settings/team" },
 *     ]}
 *   />
 *
 * Per-step `done` is supplied by the caller (it reflects real app state, e.g.
 * "has at least one project"). This component owns only the card-level
 * dismissal/completion; it does not persist individual step state.
 *
 * HYDRATION: visibility depends on persisted `isOnboardingDone`, so the card is
 * gated on `hydrated` and never renders on the server / first client render —
 * a finished checklist never flashes (#418-safe). Honours the tooltips master
 * switch too.
 */

import * as React from "react";
import Link from "next/link";
import {
  Check,
  Circle,
  ChevronRight,
  Sparkles,
  X,
  PartyPopper,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGuidance } from "@/lib/guidance";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface OnboardingStep {
  /** Stable id for the step (for React keys + caller-side tracking). */
  id: string;
  /** Row label. */
  label: React.ReactNode;
  /** Optional one-line description under the label. */
  description?: React.ReactNode;
  /** Optional route the step links to (renders the row as a link). */
  href?: string;
  /** Optional click handler (alternative to href, e.g. opens a modal). */
  onClick?: () => void;
  /** Whether the caller considers this step complete. Default false. */
  done?: boolean;
}

export interface OnboardingChecklistProps {
  /** Persisted completion key (e.g. "staff.first-run"). */
  storageKey: string;
  /** Card heading. Default "Welcome — let's get you set up". */
  title?: React.ReactNode;
  /** Sub-copy under the heading. */
  subtitle?: React.ReactNode;
  /** The steps. */
  steps: OnboardingStep[];
  /** Label for the finish button. Default "Done". */
  doneLabel?: string;
  /** Whether to show the "Skip for now" control. Default true. */
  allowSkip?: boolean;
  /** Called when the card is completed or skipped. */
  onComplete?: () => void;
  /** Extra classes for the card. */
  className?: string;
}

export function OnboardingChecklist({
  storageKey,
  title = "Welcome — let's get you set up",
  subtitle,
  steps,
  doneLabel = "Done",
  allowSkip = true,
  onComplete,
  className,
}: OnboardingChecklistProps) {
  const {
    hydrated,
    tooltipsEnabled,
    isOnboardingDone,
    completeOnboarding,
  } = useGuidance();

  const done = isOnboardingDone(storageKey);
  const visible = hydrated && tooltipsEnabled && !done && steps.length > 0;

  if (!visible) return null;

  const completedCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = total === 0 ? 0 : Math.round((completedCount / total) * 100);
  const allDone = completedCount === total;

  function finish() {
    completeOnboarding(storageKey);
    onComplete?.();
  }

  return (
    <div
      className={cn(
        "po-card relative overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
      role="region"
      aria-label="Onboarding checklist"
    >
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border/60 p-5">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          {allDone ? (
            <PartyPopper className="h-5 w-5" strokeWidth={1.75} />
          ) : (
            <Sparkles className="h-5 w-5" strokeWidth={1.75} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="pr-6 text-base font-semibold text-foreground">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
          )}
          {/* Progress */}
          <div className="mt-3 flex items-center gap-2.5">
            <div
              className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Setup progress"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
              {completedCount}/{total}
            </span>
          </div>
        </div>

        {allowSkip && (
          <button
            type="button"
            onClick={finish}
            aria-label="Dismiss checklist"
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Steps */}
      <ul className="divide-y divide-border/60">
        {steps.map((step) => {
          const inner = (
            <span className="flex w-full items-center gap-3 px-5 py-3 text-left">
              <span
                className={cn(
                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  step.done
                    ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300"
                    : "text-muted-foreground/50",
                )}
                aria-hidden
              >
                {step.done ? (
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                ) : (
                  <Circle className="h-3.5 w-3.5" strokeWidth={2} />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block text-sm font-medium",
                    step.done
                      ? "text-muted-foreground line-through"
                      : "text-foreground",
                  )}
                >
                  {step.label}
                </span>
                {step.description && (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {step.description}
                  </span>
                )}
              </span>
              {(step.href || step.onClick) && !step.done && (
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </span>
          );

          const rowClass =
            "block transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

          return (
            <li key={step.id}>
              {step.href ? (
                <Link href={step.href} className={rowClass}>
                  {inner}
                </Link>
              ) : step.onClick ? (
                <button
                  type="button"
                  onClick={step.onClick}
                  className={cn(rowClass, "w-full")}
                >
                  {inner}
                </button>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-border/60 px-5 py-3">
        <p className="text-xs text-muted-foreground">
          {allDone
            ? "All set — nice work!"
            : `${total - completedCount} step${
                total - completedCount === 1 ? "" : "s"
              } to go`}
        </p>
        <div className="flex items-center gap-2">
          {allowSkip && !allDone && (
            <Button variant="ghost" size="sm" onClick={finish}>
              Skip for now
            </Button>
          )}
          <Button
            variant={allDone ? "default" : "outline"}
            size="sm"
            onClick={finish}
          >
            {allDone ? "Finish" : doneLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// TourPopover / OnboardingDialog — a guided first-run scaffold.
// Generic + data-driven: pass `steps`, it walks them in a centered dialog.
// Persists "seen" via the same onboarding store under `storageKey`.
// ──────────────────────────────────────────────────────────────────────────

export interface TourStep {
  /** Heading for this slide. */
  title: React.ReactNode;
  /** Body copy. */
  body: React.ReactNode;
  /** Optional illustration / node above the copy. */
  media?: React.ReactNode;
}

export interface TourPopoverProps {
  /** Persisted "seen" key (e.g. "staff.welcome-tour"). */
  storageKey: string;
  /** The slides. */
  steps: TourStep[];
  /** Auto-open on first run (when not yet seen). Default true. */
  autoStart?: boolean;
  /** Controlled open (overrides autoStart logic when provided). */
  open?: boolean;
  /** Open-state change callback (controlled mode). */
  onOpenChange?: (open: boolean) => void;
  /** Label for the final-step button. Default "Get started". */
  finishLabel?: string;
  /** Called when the tour is finished or skipped. */
  onComplete?: () => void;
}

/**
 * A lightweight guided tour rendered in the kit Dialog. Not a spotlight
 * overlay (that needs per-target DOM measurement and page wiring, which is a
 * Round-2 concern) — this is the content-driven "welcome, here's the gist"
 * flow that the staff + client onboarding can drive by passing slides.
 *
 *   <TourPopover
 *     storageKey="staff.welcome-tour"
 *     steps={[
 *       { title: "Welcome to Project Ops", body: "Plan work, track time, bill clients." },
 *       { title: "Everything is one workspace", body: "Projects, tasks, time, and CRM live together." },
 *     ]}
 *   />
 *
 * Exported also as `OnboardingDialog` for callers who prefer that name.
 */
export function TourPopover({
  storageKey,
  steps,
  autoStart = true,
  open: openProp,
  onOpenChange,
  finishLabel = "Get started",
  onComplete,
}: TourPopoverProps) {
  const {
    hydrated,
    tooltipsEnabled,
    isOnboardingDone,
    completeOnboarding,
  } = useGuidance();

  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const [index, setIndex] = React.useState(0);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;

  // Auto-open once, after hydration, only if unseen + tooltips on. Reading the
  // persisted "seen" flag in an effect (not render) keeps server/client in sync.
  React.useEffect(() => {
    if (isControlled || !autoStart) return;
    if (!hydrated || !tooltipsEnabled) return;
    if (!isOnboardingDone(storageKey)) setUncontrolledOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, tooltipsEnabled, autoStart, isControlled, storageKey]);

  function setOpen(next: boolean) {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  }

  function finish() {
    completeOnboarding(storageKey);
    setOpen(false);
    onComplete?.();
  }

  if (steps.length === 0) return null;

  const clamped = Math.min(index, steps.length - 1);
  const step = steps[clamped];
  const isLast = clamped === steps.length - 1;
  const isFirst = clamped === 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing via overlay / Esc counts as completing the tour.
        if (!next) finish();
        else setOpen(true);
      }}
    >
      <DialogContent className="sm:max-w-md">
        {step.media && <div className="mb-1">{step.media}</div>}
        <DialogHeader>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* Step dots */}
        {steps.length > 1 && (
          <div
            className="flex items-center justify-center gap-1.5 py-1"
            aria-hidden
          >
            {steps.map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === clamped
                    ? "w-5 bg-primary"
                    : "w-1.5 bg-muted-foreground/30",
                )}
              />
            ))}
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip
          </Button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                Back
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={finish}>
                {finishLabel}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  setIndex((i) => Math.min(steps.length - 1, i + 1))
                }
              >
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Alias — same component, for callers who prefer the "dialog" name. */
export const OnboardingDialog = TourPopover;
