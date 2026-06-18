/**
 * Reporting API client — portfolio / profitability / throughput.
 *
 * Wraps the backend reporting controllers under `/reporting/*`. Mirrors the
 * hand-rolled axios pattern used across the app (`lib/time-tracking-api.ts`,
 * `lib/tasks-api.ts`): every call goes through the shared `api` instance in
 * `lib/api.ts`, which injects the Bearer `access_token` and the
 * `X-Workspace-Id` header.
 *
 * Conventions, matching the backend reporting serializers:
 *   - Hour figures (budgetHours, loggedHours, billableHours, …) are JS
 *     `number` (decimal hours).
 *   - Money figures (budgetAmount, billedAmount, margin, …) are JS `number`
 *     in major units (dollars). They may be `null` for callers without
 *     financial visibility (STAFF/CLIENT) — every consumer must tolerate null.
 *   - Percentages (pctHours, pctAmount, percentComplete, marginPct,
 *     realization) are `number`, already expressed 0–100.
 *   - Date-range filters are ISO-8601 strings on `from` / `to`.
 */

import api from './api';

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** A {label,value} pair as returned for every breakdown / time series. */
export interface SeriesPoint {
  label: string;
  value: number;
}

/** The echoed period on profitability / throughput responses. */
export interface ReportPeriod {
  from?: string | null;
  to?: string | null;
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface PortfolioProject {
  projectId: string;
  projectNumber: string;
  title: string;
  clientName: string | null;
  status: string;
  budgetHours: number | null;
  loggedHours: number | null;
  /** Logged ÷ budget hours, 0–100. May be null when no budget set. */
  pctHours: number | null;
  budgetAmount: number | null;
  billedAmount: number | null;
  /** Billed ÷ budget amount, 0–100. May be null. */
  pctAmount: number | null;
  tasksTotal: number;
  tasksCompleted: number;
  /** Completed ÷ total tasks, 0–100. */
  percentComplete: number;
  overBudget: boolean;
}

export interface PortfolioTotals {
  projects: number;
  activeProjects: number;
  budgetHours: number | null;
  loggedHours: number | null;
  budgetAmount: number | null;
  billedAmount: number | null;
  tasksTotal: number;
  tasksCompleted: number;
}

export interface PortfolioReport {
  projects: PortfolioProject[];
  totals: PortfolioTotals;
  statusBreakdown: SeriesPoint[];
}

// ---------------------------------------------------------------------------
// Profitability
// ---------------------------------------------------------------------------

export interface ProfitabilityProject {
  projectId: string;
  title: string;
  billableHours: number | null;
  billableAmount: number | null;
  billedAmount: number | null;
  costBasis: number | null;
  /** billedAmount − costBasis. Null when money is hidden. */
  margin: number | null;
  /** margin ÷ billedAmount, 0–100. Null when money is hidden. */
  marginPct: number | null;
  /** billedAmount ÷ billableAmount, 0–100. Null when money is hidden. */
  realization: number | null;
}

export interface ProfitabilityTotals {
  billableHours: number | null;
  billableAmount: number | null;
  billedAmount: number | null;
  costBasis: number | null;
  margin: number | null;
  marginPct: number | null;
  realization: number | null;
}

export interface ProfitabilityReport {
  period: ReportPeriod;
  projects: ProfitabilityProject[];
  totals: ProfitabilityTotals;
}

// ---------------------------------------------------------------------------
// Throughput
// ---------------------------------------------------------------------------

export interface ThroughputCount {
  total: number;
  series: SeriesPoint[];
}

export interface ThroughputReport {
  period: ReportPeriod;
  tasksCompleted: ThroughputCount;
  projectsCompleted: ThroughputCount;
  tasksByStatus: SeriesPoint[];
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

export const getPortfolioReport = async (): Promise<PortfolioReport> => {
  const { data } = await api.get('/reporting/portfolio');
  return data;
};

export const getProfitabilityReport = async (params?: {
  from?: string;
  to?: string;
}): Promise<ProfitabilityReport> => {
  const { data } = await api.get('/reporting/profitability', { params });
  return data;
};

export const getThroughputReport = async (params?: {
  from?: string;
  to?: string;
}): Promise<ThroughputReport> => {
  const { data } = await api.get('/reporting/throughput', { params });
  return data;
};

// ---------------------------------------------------------------------------
// Small formatting helpers (kept here so the reporting surfaces share one
// vocabulary; money tolerates the null/STAFF-redacted wire shape).
// ---------------------------------------------------------------------------

/** Format a number as USD currency; null/undefined/NaN → em-dash. */
export function formatMoney(
  value: number | string | null | undefined,
  currency = 'USD',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(0)}`;
  }
}

/** Format decimal hours, 1dp + "h"; null/undefined → em-dash. */
export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}h`;
}

/** Format a 0–100 percentage, 0dp + "%"; null/undefined → em-dash. */
export function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(0)}%`;
}
