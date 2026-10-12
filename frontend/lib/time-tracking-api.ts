/**
 * Time-Tracking / Billing API client.
 *
 * Wraps the backend NestJS Time-Tracking module (controllers under
 * `backend/src/time-tracking/**`). Mirrors the hand-rolled axios pattern used
 * across the app (`lib/tasks-api.ts`, `lib/organizations-api.ts`): every call
 * goes through the shared `api` instance in `lib/api.ts`, which injects the
 * Bearer `access_token` and the `X-Workspace-Id` header.
 *
 * Money/units conventions taken straight from the backend serializer
 * (`time-tracking/serialize.ts`) and the billing assembler:
 *   - TimeEntry / BillingRate / report numbers come back as JS `number` (Decimal→number).
 *   - durationSeconds / roundingAppliedSeconds are SECONDS (integers).
 *   - CreateTimeEntryDto.durationMinutes is MINUTES on input.
 *   - Billing draft / AO invoice money fields come back as decimal STRINGS.
 *   - All money is in major units (dollars), default currency "USD".
 */

import api from './api';

// ---------------------------------------------------------------------------
// Enums (string unions — match Prisma + DTO enums exactly)
// ---------------------------------------------------------------------------

export type TimeEntrySource = 'TIMER' | 'MANUAL' | 'IMPORTED';

/** Shared by TimeEntry.approvalStatus and TimesheetPeriod.status. */
export type ApprovalStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type RateScopeType =
  | 'TASK'
  | 'TASK_TYPE'
  | 'PROJECT'
  | 'CONTACT'
  | 'USER_PROJECT'
  | 'USER'
  | 'ROLE'
  | 'ORG';

export type TimeTaskType =
  | 'TASK'
  | 'MILESTONE'
  | 'DELIVERABLE'
  | 'REVIEW'
  | 'MEETING'
  | 'RESEARCH'
  | 'OTHER';

export type TimeUserRole = 'ADMIN' | 'MANAGER' | 'STAFF' | 'CLIENT';

/** Request-body enum on the billable-draft DTO (NOT a Prisma enum). */
export type BillableGroupBy = 'TASK' | 'ROLE' | 'DAY' | 'NONE';

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/** Serialized TimeEntry — see `time-tracking/serialize.ts` + ENTRY_INCLUDE. */
export interface TimeEntry {
  id: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  description: string | null;
  startedAt: string; // ISO
  endedAt: string | null; // ISO; null while running
  durationSeconds: number | null;
  roundingAppliedSeconds: number | null;
  source: TimeEntrySource;
  billable: boolean;
  billed: boolean;
  invoiceRef: string | null;
  lockedAt: string | null; // ISO; set once approved/billed
  billRateApplied: number | null;
  costRateApplied?: number | null; // ABSENT for CLIENT (redacted server-side)
  currency: string;
  billableAmount: number | null;
  approvalStatus: ApprovalStatus;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  timesheetPeriodId: string | null;
  createdAt: string;
  updatedAt: string;
  project: { id: string; projectNumber: string; title: string };
  task: { id: string; title: string; type: TimeTaskType } | null;
}

export interface TimeEntriesPage {
  data: TimeEntry[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface TimesheetPeriod {
  id: string;
  workspaceId: string;
  userId: string;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  status: ApprovalStatus;
  submittedAt: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present only on the /timesheets/submit response. */
  entryCount?: number;
}

export interface BillingRate {
  id: string;
  workspaceId: string;
  scopeType: RateScopeType;
  userId: string | null;
  projectId: string | null;
  contactId: string | null;
  taskId: string | null;
  taskType: TimeTaskType | null;
  role: TimeUserRole | null;
  organizationId: string | null;
  billRate: number;
  costRate: number | null;
  currency: string;
  effectiveFrom: string; // ISO
  effectiveTo: string | null; // ISO
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

// Reports -------------------------------------------------------------------

export interface UtilizationRow {
  userId: string;
  name: string;
  email?: string;
  totalHours: number;
  billableHours: number;
  utilization: number; // percent, 1dp
}

export interface UtilizationReport {
  period: { from?: string; to?: string };
  rows: UtilizationRow[];
}

export interface RealizationReport {
  period: { from?: string; to?: string };
  billableAmount: number;
  billedAmount: number;
  realization: number; // percent, 1dp
}

export interface WipRow {
  projectId: string;
  project?: {
    id: string;
    projectNumber: string;
    title: string;
    clientName: string;
  };
  wipAmount: number;
  wipHours: number;
}

export interface WipReport {
  totalWip: number;
  rows: WipRow[];
}

// Billing draft -------------------------------------------------------------

/** Money/quantity fields are decimal STRINGS straight from the assembler. */
export interface AssembledLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  sourceRefs: string[];
}

export interface DraftSummary {
  currency: string;
  total: string; // decimal string
  entryCount: number;
  lineItems: AssembledLine[];
}

/** AO invoice money fields are STRINGS|null. */
export interface AoInvoice {
  id?: string;
  invoiceNumber?: string;
  status?: string;
  total?: string | null;
  balanceDue?: string | null;
  externalRef?: string;
  pdfUrl?: string;
  raw?: unknown;
}

export interface BillableDraftInvoiced {
  status: 'INVOICED';
  invoice: AoInvoice;
  previewUrl: string;
  draft: DraftSummary;
  unpricedCount: number;
}

export interface BillableDraftDraftOnly {
  status: 'DRAFT_ONLY';
  reason: 'NOT_ENTITLED' | 'UNREACHABLE' | 'DISABLED' | 'ERROR';
  message: string;
  connectAccountingOps: true;
  externalRef: string;
  previewUrl: string;
  draft: DraftSummary;
  unpricedCount: number;
}

export interface BillableDraftPending {
  /** Accounting-Ops created/returned a draft, but the requested issue failed. */
  status: 'DRAFT';
  invoice: AoInvoice;
  reason: 'NOT_ENTITLED' | 'UNREACHABLE' | 'DISABLED' | 'ERROR';
  message: string;
  externalRef: string;
  previewUrl: string;
  draft: DraftSummary;
  unpricedCount: number;
}

export type BillableDraftResult =
  | BillableDraftInvoiced
  | BillableDraftDraftOnly
  | BillableDraftPending;

// ---------------------------------------------------------------------------
// Request shapes
// ---------------------------------------------------------------------------

export interface StartTimerInput {
  projectId?: string;
  taskId?: string;
  description?: string;
}

export interface CreateTimeEntryInput {
  projectId?: string;
  taskId?: string;
  description?: string;
  startedAt?: string; // ISO
  endedAt?: string; // ISO
  durationMinutes?: number;
  billable?: boolean;
  source?: TimeEntrySource;
}

export interface UpdateTimeEntryInput {
  description?: string;
  taskId?: string;
  startedAt?: string; // ISO
  endedAt?: string; // ISO
  durationMinutes?: number;
  billable?: boolean;
}

export interface QueryTimeEntriesInput {
  userId?: string;
  projectId?: string;
  taskId?: string;
  from?: string; // ISO
  to?: string; // ISO
  billable?: boolean;
  billed?: boolean;
  approvalStatus?: ApprovalStatus;
  page?: number;
  limit?: number;
}

export interface CreateBillingRateInput {
  scopeType: RateScopeType;
  userId?: string;
  projectId?: string;
  contactId?: string;
  taskId?: string;
  organizationId?: string;
  taskType?: TimeTaskType;
  role?: TimeUserRole;
  billRate: number;
  costRate?: number;
  currency?: string;
  effectiveFrom?: string; // ISO
  effectiveTo?: string | null; // ISO
}

export interface CreateBillableDraftInput {
  projectId?: string;
  clientId?: string;
  periodStart?: string; // ISO
  periodEnd?: string; // ISO
  groupBy?: BillableGroupBy;
  autoSend?: boolean;
  /** Preview by default; true asks Accounting-Ops to issue and post. */
  issue?: boolean;
}

// ---------------------------------------------------------------------------
// Time entries + timer
// ---------------------------------------------------------------------------

export const startTimer = async (input: StartTimerInput): Promise<TimeEntry> => {
  const { data } = await api.post('/time-entries/timer/start', input);
  return data;
};

export const stopTimer = async (): Promise<TimeEntry> => {
  const { data } = await api.post('/time-entries/timer/stop');
  return data;
};

export const getRunningTimer = async (): Promise<TimeEntry | null> => {
  const { data } = await api.get('/time-entries/timer/running');
  return data ?? null;
};

export const createTimeEntry = async (input: CreateTimeEntryInput): Promise<TimeEntry> => {
  const { data } = await api.post('/time-entries', input);
  return data;
};

export const getTimeEntries = async (params?: QueryTimeEntriesInput): Promise<TimeEntriesPage> => {
  const { data } = await api.get('/time-entries', { params });
  return data;
};

export const getTimeEntry = async (id: string): Promise<TimeEntry> => {
  const { data } = await api.get(`/time-entries/${id}`);
  return data;
};

export const updateTimeEntry = async (
  id: string,
  input: UpdateTimeEntryInput,
): Promise<TimeEntry> => {
  const { data } = await api.patch(`/time-entries/${id}`, input);
  return data;
};

export const deleteTimeEntry = async (id: string): Promise<{ message: string }> => {
  const { data } = await api.delete(`/time-entries/${id}`);
  return data;
};

// ---------------------------------------------------------------------------
// Timesheets
// ---------------------------------------------------------------------------

export const submitTimesheet = async (periodStart?: string): Promise<TimesheetPeriod> => {
  const { data } = await api.post('/timesheets/submit', { periodStart });
  return data;
};

export const approveTime = async (input: {
  timesheetPeriodId?: string;
  timeEntryIds?: string[];
}): Promise<{ approved: number }> => {
  const { data } = await api.post('/timesheets/approve', input);
  return data;
};

export const rejectTime = async (input: {
  timesheetPeriodId?: string;
  timeEntryIds?: string[];
  reason: string;
}): Promise<{ rejected: number }> => {
  const { data } = await api.post('/timesheets/reject', input);
  return data;
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const getUtilization = async (params?: {
  from?: string;
  to?: string;
  userId?: string;
}): Promise<UtilizationReport> => {
  const { data } = await api.get('/time-reports/utilization', { params });
  return data;
};

export const getRealization = async (params?: {
  from?: string;
  to?: string;
}): Promise<RealizationReport> => {
  const { data } = await api.get('/time-reports/realization', { params });
  return data;
};

export const getWip = async (): Promise<WipReport> => {
  const { data } = await api.get('/time-reports/wip');
  return data;
};

/**
 * Server-rendered CSV of in-scope entries (cost never included; bill rate
 * blanked for CLIENT). Returns the raw CSV text — callers can trigger a
 * download via `downloadCsvText` below.
 */
export const exportTimeEntriesCsv = async (params?: {
  from?: string;
  to?: string;
  projectId?: string;
}): Promise<string> => {
  const { data } = await api.get('/time-reports/export.csv', {
    params,
    responseType: 'text',
  });
  return data as string;
};

// ---------------------------------------------------------------------------
// Billing rates (manager-only on the backend)
// ---------------------------------------------------------------------------

export const getBillingRates = async (params?: {
  scopeType?: RateScopeType;
  projectId?: string;
  userId?: string;
}): Promise<BillingRate[]> => {
  const { data } = await api.get('/billing-rates', { params });
  return data;
};

export const createBillingRate = async (input: CreateBillingRateInput): Promise<BillingRate> => {
  const { data } = await api.post('/billing-rates', input);
  return data;
};

export const updateBillingRate = async (
  id: string,
  input: Partial<CreateBillingRateInput>,
): Promise<BillingRate> => {
  const { data } = await api.patch(`/billing-rates/${id}`, input);
  return data;
};

export const deleteBillingRate = async (id: string): Promise<{ message: string }> => {
  const { data } = await api.delete(`/billing-rates/${id}`);
  return data;
};

// ---------------------------------------------------------------------------
// Billing (rollup → draft invoice / AO sync) — manager-only on the backend
// ---------------------------------------------------------------------------

export const createBillableDraft = async (
  input: CreateBillableDraftInput,
): Promise<BillableDraftResult> => {
  const { data } = await api.post('/billing/drafts', input);
  return data;
};

export const syncInvoiceStatus = async (): Promise<{ synced: number }> => {
  const { data } = await api.post('/billing/sync-invoice-status');
  return data;
};

// ---------------------------------------------------------------------------
// Small client-side helpers (units / money formatting)
// ---------------------------------------------------------------------------

/** Seconds → "H:MM:SS" (timer display). */
export function formatHms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Seconds → decimal hours, 2dp (e.g. 5400 → 1.5). */
export function secondsToHours(seconds: number | null | undefined): number {
  if (!seconds) return 0;
  return Math.round((seconds / 3600) * 100) / 100;
}

/** Format a number/decimal-string as currency. Tolerates both wire shapes. */
export function formatMoney(value: number | string | null | undefined, currency = 'USD'): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'USD',
    }).format(n);
  } catch {
    // Unknown currency code — fall back to a plain prefix.
    return `${currency} ${n.toFixed(2)}`;
  }
}

/** Trigger a browser download of CSV text returned by the server. */
export function downloadCsvText(filename: string, csv: string): void {
  if (typeof window === 'undefined') return;
  // Prepend BOM so Excel recognises UTF-8 (matches lib/csv-export.ts).
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Shared lightweight pickers (projects / tasks / users) — match the existing
// app fetch shapes (`/projects` → { data, meta }, `/users` → { data } | []).
// ---------------------------------------------------------------------------

export interface ProjectOption {
  id: string;
  projectNumber: string;
  title: string;
  clientName?: string;
  contactId?: string | null;
}

export interface TaskOption {
  id: string;
  title: string;
  type: TimeTaskType;
  projectId: string;
}

export interface UserOption {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
}

export const getProjectOptions = async (): Promise<ProjectOption[]> => {
  const { data } = await api.get('/projects', {
    params: { page: 1, limit: 1000 },
  });
  return data.data ?? data ?? [];
};

export const getProjectTaskOptions = async (projectId: string): Promise<TaskOption[]> => {
  const { data } = await api.get(`/tasks/project/${projectId}`, {
    params: { take: 500 },
  });
  return data.data ?? data ?? [];
};

export const getUserOptions = async (): Promise<UserOption[]> => {
  const { data } = await api.get('/users', { params: { take: 200 } });
  const list: UserOption[] = data.data ?? data ?? [];
  return list;
};

/** Display name helper shared across surfaces. */
export function userLabel(u: {
  firstName: string | null;
  lastName: string | null;
  email: string;
}): string {
  const name = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
  return name || u.email;
}
