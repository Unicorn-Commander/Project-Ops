import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailOpsComposeRequest, EmailOpsComposeResult, EmailOpsPort } from './email-ops.port';

/** Default per-request timeout (ms). Override via EMAIL_OPS_TIMEOUT_MS. */
export const EMAIL_OPS_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Wire contract (documented in docs/integrations/EMAIL-OPS.md): the client
 * POSTs a JSON-RPC `tools/call` for the Email-Ops MCP `compose_email` tool to
 *   POST {EMAIL_OPS_BASE_URL}/api/v1/mcp
 * with the suite service-token bearer, exactly like Customer-Ops federating
 * Email-Ops. Arguments carry the idempotency tuple:
 *   workspace_id + external_source = 'project-ops' + external_ref
 * plus `mode` (`send` | `draft`) and the message fields.
 *
 * Auth: EMAIL_OPS_SERVICE_TOKEN (a long-lived service bearer minted for
 * Project-Ops; name only — the value lives in the env / Vaultwarden).
 *
 * Unconfigured ⇒ `isConfigured() === false` and `compose` returns
 * `{ ok: false, reason: 'UNCONFIGURED' }` WITHOUT touching the network, so a
 * caller (e.g. EmailService) keeps its today-SMTP behaviour when the flag is off.
 * This client never throws and never logs the token.
 */
@Injectable()
export class HttpEmailOpsClient extends EmailOpsPort {
  private readonly logger = new Logger(HttpEmailOpsClient.name);

  /** Transport test seam (never swapped at runtime). */
  protected fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  constructor(private readonly config: ConfigService) {
    super();
  }

  useFetch(impl: typeof fetch): this {
    this.fetchImpl = impl;
    return this;
  }

  private get baseUrl(): string | undefined {
    const raw = this.config.get<string>('EMAIL_OPS_BASE_URL');
    const trimmed = raw?.trim().replace(/\/+$/, '');
    return trimmed ? trimmed : undefined;
  }

  private get serviceToken(): string | undefined {
    const raw = this.config.get<string>('EMAIL_OPS_SERVICE_TOKEN');
    return raw?.trim() ? raw.trim() : undefined;
  }

  private get timeoutMs(): number {
    const raw = this.config.get<string>('EMAIL_OPS_TIMEOUT_MS');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : EMAIL_OPS_DEFAULT_TIMEOUT_MS;
  }

  isConfigured(): boolean {
    return !!this.baseUrl && !!this.serviceToken;
  }

  async compose(req: EmailOpsComposeRequest): Promise<EmailOpsComposeResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        reason: 'UNCONFIGURED',
        message:
          'Connect Email-Ops: set EMAIL_OPS_BASE_URL and EMAIL_OPS_SERVICE_TOKEN to route mail through Email-Ops.',
      };
    }
    if (!req.workspaceId?.trim() || !req.externalRef?.trim() || !req.toAddress?.trim()) {
      return {
        ok: false,
        reason: 'ERROR',
        message: 'An Email-Ops compose needs workspaceId, externalRef and toAddress.',
      };
    }

    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'compose_email',
        arguments: {
          workspace_id: req.workspaceId,
          external_source: 'project-ops',
          external_ref: req.externalRef,
          to_address: req.toAddress,
          subject: req.subject ?? '',
          body: req.body ?? '',
          mode: req.mode,
          ...(req.contactId ? { contact_id: req.contactId } : {}),
          ...(req.inReplyToThreadId ? { in_reply_to_thread_id: req.inReplyToThreadId } : {}),
        },
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.post(body, controller);
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(body: unknown, controller: AbortController): Promise<EmailOpsComposeResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/v1/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${this.serviceToken}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      this.logger.warn(`Email-Ops unreachable: ${(err as Error).message}`);
      return { ok: false, reason: 'UNREACHABLE', message: 'Email-Ops is unreachable right now.' };
    }

    if (res.status === 401 || res.status === 403) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Email-Ops denied compose (${res.status}): ${text.slice(0, 200)}`);
      return {
        ok: false,
        reason: 'DENIED',
        message:
          'Email-Ops declined the compose (service token not entitled, or the workspace is not federated).',
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Email-Ops compose failed ${res.status}: ${text.slice(0, 200)}`);
      return { ok: false, reason: 'ERROR', message: `Email-Ops error ${res.status}.` };
    }

    return this.parseResult(res);
  }

  private async parseResult(res: Response): Promise<EmailOpsComposeResult> {
    const data: unknown = await res.json().catch(() => null);
    // MCP tools/call result: { result: { structuredContent: {...} } } or
    // { result: { content: [{ type: 'text', text: '<json>' }] } }.
    const result = (data as { result?: unknown })?.result as
      | { structuredContent?: unknown; content?: { type?: string; text?: string }[] }
      | undefined;
    const structured = result?.structuredContent as
      | { id?: string; thread_id?: string | null; status?: string }
      | undefined;
    const id = structured?.id ?? this.textResultId(result?.content);
    if (!id) {
      return {
        ok: false,
        reason: 'ERROR',
        message: 'Email-Ops returned an unreadable compose result.',
      };
    }
    return {
      ok: true,
      messageId: id,
      threadId: structured?.thread_id ?? null,
      status: structured?.status ?? 'queued',
    };
  }

  private textResultId(content?: { type?: string; text?: string }[]): string | undefined {
    const text = content?.find((c) => c?.type === 'text')?.text;
    if (!text) return undefined;
    try {
      const parsed = JSON.parse(text) as { id?: string };
      return parsed.id;
    } catch {
      return undefined;
    }
  }
}
