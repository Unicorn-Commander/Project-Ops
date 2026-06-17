"use client";

/**
 * Budget burn-down UI — two surfaces over one backend contract.
 *
 *   GET /projects/:projectId/budget  →  ProjectBudget
 *
 * The same numbers drive a full <BudgetPanel> on the project detail page
 * (two labelled progress bars, hours + amount, each with a clear
 * over-budget state) and a compact <BudgetBadge> on the projects list
 * (one pill: "72% of budget" or "Over budget").
 *
 * Both fail soft: when a project has no budget set (both `budgetHours`
 * and `budgetAmount` null) they render nothing, so the surface only
 * appears once someone has actually scoped the work.
 *
 * Styling matches the rest of the suite — indigo primary, amber as the
 * "approaching the line" warning, rose/destructive once over. Progress
 * strips reuse the same 8px rounded-track look as ProjectSnapshot's
 * completion bar so the detail page reads as one product.
 */

import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Wallet, Clock, DollarSign, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/**
 * The exact shape returned by `GET /projects/:projectId/budget`.
 * Money fields arrive as decimal strings (Prisma Decimal) to avoid
 * float drift; we parse with Number() only at render time.
 */
export interface ProjectBudget {
  budgetHours: number | null;
  budgetAmount: string | null;
  loggedHours: number;
  billableHours: number;
  billedAmount: string;
  pctHours: number | null;
  pctAmount: number | null;
  overBudgetHours: boolean;
  overBudgetAmount: boolean;
}

/**
 * The additive subset now also included per-project in the list
 * response. Optional everywhere so older/partial payloads don't break
 * typing on the list page.
 */
export interface ProjectBudgetSummary {
  budgetHours?: number | null;
  budgetAmount?: string | null;
  loggedHours?: number | null;
  pctHours?: number | null;
}

/** True when at least one budget dimension is set. */
export function hasBudget(
  b: ProjectBudget | ProjectBudgetSummary | null | undefined,
): boolean {
  if (!b) return false;
  return (
    (b.budgetHours !== null && b.budgetHours !== undefined) ||
    (b.budgetAmount !== null && b.budgetAmount !== undefined)
  );
}

function clampPct(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return 0;
  return Math.max(0, Math.min(100, pct));
}

function roundPct(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return 0;
  return Math.round(pct);
}

// Hours render with up to one decimal but drop a trailing ".0".
function formatHours(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/* ------------------------------------------------------------------ *
 *  Detail panel — one full Budget card with two bars.
 * ------------------------------------------------------------------ */

interface BudgetBarProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
  /** Left side of the "x of y" caption (e.g. "18.5h" or "$1,200.00"). */
  used: string;
  /** Right side of the caption (the budget ceiling). */
  ceiling: string;
  pct: number | null;
  over: boolean;
}

function BudgetBar({ icon: Icon, label, used, ceiling, pct, over }: BudgetBarProps) {
  const display = roundPct(pct);
  const width = clampPct(pct);
  // Amber once we cross 90% but are still inside the budget — a gentle
  // "watch this" before the hard red.
  const nearLimit = !over && display >= 90;

  const barColor = over
    ? "bg-destructive"
    : nearLimit
      ? "bg-amber-500 dark:bg-amber-400"
      : "bg-primary";

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
          {label}
        </span>
        <span
          className={`text-sm font-semibold tabular-nums ${
            over
              ? "text-destructive"
              : nearLimit
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground"
          }`}
        >
          {over ? (
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
              {display}%
            </span>
          ) : (
            <>{display}%</>
          )}
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={display}
        aria-label={`${label}: ${display}% of budget used`}
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 text-xs">
        <span className="text-muted-foreground tabular-nums">
          {used} <span className="opacity-70">of</span> {ceiling}
        </span>
        {over && (
          <span className="font-medium text-destructive">Over budget</span>
        )}
      </div>
    </div>
  );
}

export function BudgetPanel({ budget }: { budget: ProjectBudget | null }) {
  if (!hasBudget(budget) || !budget) return null;

  const billed = Number(budget.billedAmount ?? 0);
  const budgetAmount =
    budget.budgetAmount !== null ? Number(budget.budgetAmount) : null;

  const showHours = budget.budgetHours !== null;
  const showAmount = budgetAmount !== null;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Wallet className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Budget</h2>
      </div>
      <div className="space-y-5">
        {showHours && (
          <BudgetBar
            icon={Clock}
            label="Hours logged"
            used={`${formatHours(budget.loggedHours)}h`}
            ceiling={`${formatHours(budget.budgetHours as number)}h`}
            pct={budget.pctHours}
            over={budget.overBudgetHours}
          />
        )}
        {showAmount && (
          <BudgetBar
            icon={DollarSign}
            label="Amount billed"
            used={formatCurrency(billed)}
            ceiling={formatCurrency(budgetAmount as number)}
            pct={budget.pctAmount}
            over={budget.overBudgetAmount}
          />
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 *  List badge — one compact pill for a project row/card.
 * ------------------------------------------------------------------ */

/**
 * Compact budget badge for the projects list. Prefers the hours
 * dimension (most teams scope in hours); falls back to amount %, then
 * to a derived hours % if the backend didn't send one. Renders nothing
 * when no budget is set so rows without a budget stay clean.
 */
export function BudgetBadge({
  budget,
  className,
}: {
  budget: ProjectBudgetSummary | null | undefined;
  className?: string;
}) {
  const computed = useMemo(() => {
    if (!hasBudget(budget) || !budget) return null;

    // Prefer an explicit pctHours; otherwise derive from logged/budget.
    let pct = budget.pctHours ?? null;
    if (
      (pct === null || pct === undefined) &&
      budget.budgetHours != null &&
      budget.budgetHours > 0 &&
      budget.loggedHours != null
    ) {
      pct = (budget.loggedHours / budget.budgetHours) * 100;
    }
    if (pct === null || pct === undefined) return null;

    const display = roundPct(pct);
    const over = display > 100;
    const nearLimit = !over && display >= 90;
    return { display, over, nearLimit };
  }, [budget]);

  if (!computed) return null;

  const tone = computed.over
    ? "bg-destructive/10 text-destructive"
    : computed.nearLimit
      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : "bg-primary/10 text-primary";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tone} ${className ?? ""}`}
      title={
        computed.over
          ? "Over budget"
          : `${computed.display}% of budget used`
      }
    >
      {computed.over ? (
        <>
          <AlertTriangle className="h-3 w-3" strokeWidth={2} />
          Over budget
        </>
      ) : (
        <>
          <Wallet className="h-3 w-3" strokeWidth={1.75} />
          {computed.display}% of budget
        </>
      )}
    </span>
  );
}
