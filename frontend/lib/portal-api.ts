import api from "./api";

/**
 * Typed client for the two-way client-portal surface
 * (`/api/v1/client-portal/*`). Mirrors the NestJS contract in
 * `backend/src/client-portal/` exactly:
 *
 *   CLIENT-facing (the signed-in CLIENT, scoped to their org by the service):
 *     - GET  /client-portal/approvals?status&limit&offset   -> { data, total }
 *     - POST /client-portal/approvals/:id/decision           -> Approval
 *     - GET  /client-portal/projects/:id/comments            -> PortalComment[]
 *     - POST /client-portal/projects/:id/comments            -> PortalComment
 *     - GET  /client-portal/invoices                         -> PortalInvoice[]
 *     - GET  /client-portal/invoices/:id                     -> PortalInvoice
 *
 *   STAFF-facing (gated by RolesGuard on the controller):
 *     - POST /client-portal/approvals                        -> Approval
 *
 * Auth + the active-workspace header (`X-Workspace-Id`) are injected by the
 * shared axios instance (`lib/api.ts`), so callers never pass them.
 */

// ── Enums (kept in lock-step with prisma `schema.prisma`) ───────────────────

export type ApprovalEntityType = "DOCUMENT" | "DELIVERABLE" | "PROJECT";

export type ClientApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CHANGES_REQUESTED";

/** The three terminal decisions a client may set (never PENDING). */
export type ApprovalDecision = Exclude<ClientApprovalStatus, "PENDING">;

// ── Types ───────────────────────────────────────────────────────────────────

/** A lightweight project reference embedded in an approval row. */
export interface ApprovalProjectRef {
  id: string;
  projectNumber: string;
  title: string;
}

/** Shape of one approval row (see `ApprovalsService.transform`). */
export interface PortalApproval {
  id: string;
  entityType: ApprovalEntityType;
  entityId: string;
  projectId: string | null;
  status: ClientApprovalStatus;
  note: string | null;
  decisionNote: string | null;
  decidedByContactId: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  project: ApprovalProjectRef | null;
}

export interface PortalApprovalsResponse {
  data: PortalApproval[];
  total: number;
}

/** A non-internal project comment (see `ClientPortalService.transformComment`). */
export interface PortalComment {
  id: string;
  projectId: string;
  content: string;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
  author: {
    id: string;
    name: string;
    role: string;
  } | null;
}

/**
 * Read-only invoice projection of a billable project
 * (see `ClientPortalService.transformInvoice`). `id === projectId` (invoices
 * are not separately keyed). `payUrl` is a deep-link stub, present ONLY when
 * there is an open balance — never an executed charge.
 */
export interface PortalInvoice {
  id: string;
  projectId: string;
  projectNumber: string;
  projectTitle: string;
  invoiceNumber: string | null;
  paymentStatus: string | null;
  billingAmount: number | null;
  amountPaid: number;
  balanceDue: number | null;
  billingDate: string | null;
  paymentDueDate: string | null;
  paymentReceivedDate: string | null;
  payUrl: string | null;
}

// ── CLIENT: Approvals ────────────────────────────────────────────────────────

/** List the signed-in client's approvals (PENDING first, then most recent). */
export async function getApprovals(params?: {
  status?: ClientApprovalStatus;
  limit?: number;
  offset?: number;
}): Promise<PortalApprovalsResponse> {
  const response = await api.get("/client-portal/approvals", { params });
  return response.data;
}

/** Record the client's decision on one of THEIR pending approvals. */
export async function decideApproval(
  approvalId: string,
  body: { decision: ApprovalDecision; note?: string }
): Promise<PortalApproval> {
  const response = await api.post(
    `/client-portal/approvals/${approvalId}/decision`,
    body
  );
  return response.data;
}

// ── CLIENT: Comments ─────────────────────────────────────────────────────────

/** Non-internal comments on one of the client's projects (newest first). */
export async function getProjectComments(
  projectId: string,
  params?: { limit?: number; offset?: number }
): Promise<PortalComment[]> {
  const response = await api.get(
    `/client-portal/projects/${projectId}/comments`,
    { params }
  );
  return response.data;
}

/** Post a comment as the signed-in client on a project they own. */
export async function postProjectComment(
  projectId: string,
  content: string
): Promise<PortalComment> {
  const response = await api.post(
    `/client-portal/projects/${projectId}/comments`,
    { content }
  );
  return response.data;
}

// ── CLIENT: Invoices (read-only) ─────────────────────────────────────────────

/** List the client's invoices (billable projects). */
export async function getInvoices(): Promise<PortalInvoice[]> {
  const response = await api.get("/client-portal/invoices");
  return response.data;
}

/** Get one invoice (incl. `payUrl` deep-link when a balance is due). */
export async function getInvoice(invoiceId: string): Promise<PortalInvoice> {
  const response = await api.get(`/client-portal/invoices/${invoiceId}`);
  return response.data;
}

// ── STAFF: Request an approval ───────────────────────────────────────────────

export interface RequestApprovalInput {
  entityType: ApprovalEntityType;
  entityId: string;
  projectId?: string;
  /** Omit to let any portal client on the linked project act on it. */
  approverContactId?: string;
  note?: string;
}

/**
 * [staff] Request a client approval on a document / deliverable / project.
 * The controller gates this with RolesGuard (ADMIN / MANAGER / STAFF).
 */
export async function requestApproval(
  input: RequestApprovalInput
): Promise<PortalApproval> {
  const response = await api.post("/client-portal/approvals", input);
  return response.data;
}

/**
 * [staff] List ALL approvals on a project (the requester's side — live client
 * decisions, not just in-session creates). Gated to ADMIN/MANAGER/STAFF.
 */
export async function getProjectApprovals(
  projectId: string
): Promise<PortalApprovalsResponse> {
  const response = await api.get(
    `/client-portal/approvals/by-project/${projectId}`
  );
  return response.data;
}

// ── Presentation helpers ─────────────────────────────────────────────────────

/** Human label for an approval status (CHANGES_REQUESTED -> "Changes requested"). */
export function approvalStatusLabel(status: ClientApprovalStatus): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "APPROVED":
      return "Approved";
    case "REJECTED":
      return "Rejected";
    case "CHANGES_REQUESTED":
      return "Changes requested";
    default:
      return status;
  }
}

/** Human label for what is being approved. */
export function entityTypeLabel(entityType: ApprovalEntityType): string {
  switch (entityType) {
    case "DOCUMENT":
      return "Document";
    case "DELIVERABLE":
      return "Deliverable";
    case "PROJECT":
      return "Project";
    default:
      return entityType;
  }
}

/**
 * Tailwind pill classes for an approval status — light + dark, self-contained
 * (the shared `statusBadgeClass` doesn't cover APPROVED / REJECTED /
 * CHANGES_REQUESTED, so the portal owns this small map).
 */
export function approvalStatusBadgeClass(status: ClientApprovalStatus): string {
  switch (status) {
    case "PENDING":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "APPROVED":
      return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
    case "REJECTED":
      return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
    case "CHANGES_REQUESTED":
      return "bg-violet-500/15 text-violet-700 dark:text-violet-300";
    default:
      return "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300";
  }
}
