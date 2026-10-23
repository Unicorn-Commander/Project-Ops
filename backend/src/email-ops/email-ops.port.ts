/**
 * Port to Email-Ops for outbound mail (the "professional mail goes through
 * Email-Ops" house rule — Apache James with agent-inbox approval, never Gmail).
 *
 * When Project-Ops needs to send a CLIENT-facing email (proposal, invoice note,
 * status update to a customer) it composes through Email-Ops in `draft` mode —
 * the message lands in the agent inbox for a human to approve. INTERNAL
 * notification emails (task assigned / mentioned) compose in `send` mode only
 * after Project-Ops proves the recipient is a non-CLIENT workspace member;
 * unproven recipients compose in `draft` mode.
 *
 * The default implementation (HttpEmailOpsClient) POSTs to the Email-Ops MCP
 * `compose_email` tool over the suite M2M rail, mirroring the Customer-Ops
 * federation seam. It is IDEMPOTENT on (workspaceId, externalSource=project-ops,
 * externalRef); a repeat returns the existing message and sends nothing twice.
 */

export const EMAIL_OPS_PORT = 'EMAIL_OPS_PORT';

export type EmailOpsMode = 'send' | 'draft';

export interface EmailOpsComposeRequest {
  /** Project-Ops workspace the email belongs to (part of the idempotency key). */
  workspaceId: string;
  /**
   * Stable, caller-chosen idempotency ref. Together with
   * `externalSource = 'project-ops'` and `workspaceId` this is the
   * (workspace_id, external_source, external_ref) key Email-Ops de-dupes on.
   * Use something like `${projectId}:${taskId}:${eventName}`.
   */
  externalRef: string;
  /** The recipient. */
  toAddress: string;
  subject: string;
  /** Plain-text body. Email-Ops' MCP compose_email carries text only. */
  body: string;
  /**
   * `send` (internal notifications, deliver immediately) vs `draft` (client-
   * facing, stage into the agent inbox for approval).
   */
  mode: EmailOpsMode;
  /**
   * Optional Contact-Ops contact id, for project/task ↔ thread linking once the
   * L1 contact linkage lands. Sent as `contact_id`; harmless when null.
   */
  contactId?: string | null;
  /** Reply into an existing Email-Ops thread (thread linking). */
  inReplyToThreadId?: string | null;
}

export type EmailOpsFailureReason = 'UNCONFIGURED' | 'UNREACHABLE' | 'DENIED' | 'ERROR';

export type EmailOpsComposeResult =
  | { ok: true; messageId: string; threadId: string | null; status: string }
  | { ok: false; reason: EmailOpsFailureReason; message: string };

export abstract class EmailOpsPort {
  /** True when EMAIL_OPS_BASE_URL + EMAIL_OPS_SERVICE_TOKEN are set. */
  abstract isConfigured(): boolean;
  /** Never throws: every failure is a typed result so callers degrade clean. */
  abstract compose(req: EmailOpsComposeRequest): Promise<EmailOpsComposeResult>;
}
