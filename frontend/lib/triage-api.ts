import api from './api';

// Priority enum string-union mirrors the backend Prisma enum and the
// `priorityBadgeClass` / `priorityTextClass` helpers in lib/badge-styles.ts.
export type TriagePriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type TriageStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPLIED'
  | 'DROPPED';

export type TriageReasonPreset =
  | 'stale'
  | 'duplicate'
  | 'not_ours'
  | 'handled_elsewhere'
  | 'vague'
  | 'personal';

// A project the agent considered routing this proposal to (other than the
// top match). Rendered as small secondary chips.
export interface TriageAlternative {
  number: string;
  title: string;
}

// The project the agent picked as the top match (present only when routed).
export interface TriageProposedProject {
  projectNumber: string;
  title: string;
}

export interface TriageProposal {
  id: string;
  rawText: string; // original action-item text
  owner: string | null; // diarized speaker label (informational; never used to assign)
  agentKeep: boolean; // false = agent judged it NOT a real task (logistics/chit-chat)
  proposedProjectId: string | null;
  proposedProject?: TriageProposedProject | null; // present when routed
  proposedTitle: string; // cleaned imperative title
  proposedPriority: TriagePriority;
  dedupeNote: string | null; // non-null = likely duplicate of an existing task
  matchScore: number | null; // 0..1 cosine to top project (informational)
  alternatives: TriageAlternative[]; // other candidate projects the agent considered
  reasoning: string | null;
  status: TriageStatus;
  sourceType: string; // e.g. 'MEETING_OPS', 'MANUAL'
  sourceRef: Record<string, any> | null; // e.g. { meetingTitle: 'Weekly Client Sync' }
  reasonPreset?: TriageReasonPreset | null;
  duplicateOfTaskId?: string | null;
  createdAt: string;
}

export interface ApproveProposalData {
  // When omitted, the backend applies the proposal to its proposedProjectId.
  targetProjectId?: string;
}

export interface RejectProposalData {
  reason?: string;
  reasonPreset?: TriageReasonPreset;
  duplicateOfTaskId?: string;
}

export interface BulkTriageProposalsData {
  proposalIds: string[];
  action: 'approve' | 'reject';
  targetProjectId?: string;
  reason?: string;
  reasonPreset?: TriageReasonPreset;
  duplicateOfTaskId?: string;
}

export interface BulkTriageProposalResult {
  id: string;
  ok: boolean;
  taskId?: string;
  error?: string;
}

export interface CreateProjectFromProposalsData {
  proposalIds: string[];
  title: string;
  clientName: string;
  description?: string;
  priority?: TriagePriority;
}

export interface CreateProjectFromProposalsResponse {
  projectId: string;
  projectNumber: string;
  applied: number;
}

// Get all proposals awaiting review (status PENDING_REVIEW). Routed proposals
// include their `proposedProject` summary.
export const getTriageProposals = async (): Promise<TriageProposal[]> => {
  const response = await api.get('/triage/proposals');
  return response.data;
};

// Approve a proposal — creates the task in `targetProjectId` (override) or, when
// omitted, in the proposal's proposedProject. Returns the updated proposal.
export const approveProposal = async (
  id: string,
  data: ApproveProposalData = {}
): Promise<TriageProposal> => {
  const response = await api.post(`/triage/proposals/${id}/approve`, data);
  return response.data;
};

// Reject a proposal — marks it REJECTED. Optional reason for the audit trail.
export const rejectProposal = async (
  id: string,
  data: RejectProposalData = {}
): Promise<TriageProposal> => {
  const response = await api.post(`/triage/proposals/${id}/reject`, data);
  return response.data;
};

// Apply the same decision to up to 200 proposals. The backend returns a result
// for every id so partial failures can remain visible to the reviewer.
export const bulkTriageProposals = async (
  data: BulkTriageProposalsData
): Promise<BulkTriageProposalResult[]> => {
  const response = await api.post('/triage/proposals/bulk', data);
  return response.data;
};

// Create a new project from a set of unassigned proposals and apply them as
// its tasks. Returns the new project's id/number and the count applied.
export const createProjectFromProposals = async (
  data: CreateProjectFromProposalsData
): Promise<CreateProjectFromProposalsResponse> => {
  const response = await api.post('/triage/create-project', data);
  return response.data;
};
