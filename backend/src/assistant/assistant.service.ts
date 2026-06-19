/**
 * Proxy from Project Ops to Unicorn Brigade's /agents/{id}/chat endpoint.
 *
 * Project Ops users authenticate against this backend with their JWT.
 * We then call Brigade with a service-level API key, but pass the user's
 * stable identifier as `user_id` so Brigade scopes per-user memory correctly
 * (Aaron's chat history isn't shared with Shafen, etc).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentActorKind, AgentVia, User } from '@prisma/client';
import { ChatMessageDto } from './dto/chat.dto';
// Agent activity capture (v1.11) — OPTIONAL: when AgentsModule is imported into
// AssistantModule the recorder is injected and each assistant turn is logged as
// an AgentEvent; if not wired, capture is skipped (app still boots).
import { AgentEventsService } from '../agents/agent-events.service';
import { WithWorkspaceClaim } from '../common/workspace/workspace.util';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly config: ConfigService,
    // OPTIONAL: present only when AgentsModule is imported into AssistantModule.
    @Optional() private readonly agentEvents?: AgentEventsService,
  ) {}

  private get brigadeBaseUrl(): string {
    return this.config.get<string>(
      'BRIGADE_URL',
      'https://brigade.magicunicorn.dev',
    );
  }

  private get brigadeApiKey(): string | undefined {
    return this.config.get<string>('BRIGADE_API_KEY');
  }

  private get agentId(): string {
    return this.config.get<string>(
      'BRIGADE_AGENT_ID',
      'project-ops-assistant',
    );
  }

  /**
   * Send a chat message; returns a non-streaming response.
   * (We use non-streaming v1 because Brigade's SSE shape needs another pass
   * to match Project Ops's UI expectations — easy to switch on later.)
   */
  async chat(
    user: User,
    body: { message: string; history?: ChatMessageDto[]; projectId?: string },
  ): Promise<{ content: string; messageId?: string }> {
    if (!this.brigadeApiKey) {
      throw new Error('BRIGADE_API_KEY is not configured on the backend.');
    }

    // Project context is currently passed as a system-style preface in the
    // history. Once Project-Ops MCP tools are registered with Brigade, the
    // agent will fetch context itself and we can drop this hint.
    const history = (body.history ?? []).slice(-20);
    if (body.projectId) {
      history.unshift({
        role: 'system',
        content: `The user is currently viewing Project Ops project id=${body.projectId}.`,
      });
    }

    const payload = {
      message: body.message,
      history,
      stream: false,
      user_id: user.id,
      // Brigade also accepts speaker_name to address the user by name
      speaker_name: `${user.firstName} ${user.lastName}`.trim() || user.email,
    };

    const url = `${this.brigadeBaseUrl}/api/v1/agents/${this.agentId}/chat`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.brigadeApiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger.error(
        `Brigade unreachable at ${url}: ${(err as Error).message}`,
      );
      throw new Error(
        'The assistant is unreachable right now. Try again in a moment.',
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(
        `Brigade chat failed ${res.status}: ${text.slice(0, 300)}`,
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error('Assistant authentication failed.');
      }
      if (res.status === 429) {
        throw new Error('Too many assistant requests — slow down for a sec.');
      }
      throw new Error('Assistant returned an error.');
    }

    const data: any = await res.json().catch(() => ({}));
    const content =
      typeof data.content === 'string'
        ? data.content
        : typeof data.response === 'string'
          ? data.response
          : typeof data.message === 'string'
            ? data.message
            : '';

    if (!content) {
      this.logger.warn(
        `Brigade chat returned empty content for user=${user.email}`,
      );
      throw new Error('Assistant returned an empty reply.');
    }

    // Best-effort agent-activity capture for this assistant turn. Never blocks
    // or fails the reply (the recorder swallows its own errors).
    this.captureTurn(user, body, data);

    return {
      content,
      messageId: data.id || data.messageId,
    };
  }

  /**
   * Record one `assistant.turn` AgentEvent. Token usage is pulled from the
   * Brigade response IF it surfaces it — we probe the common shapes
   * (`usage.{prompt,completion}_tokens` / `usage.{input,output}_tokens`,
   * top-level `tokens_in`/`tokens_out`). Brigade's non-streaming v1 reply does
   * not currently include usage in the fields this proxy reads, so tokens are
   * typically null today.
   *
   * COST: left null. There is no per-model price wired into this proxy (the LLM
   * runs behind Brigade, which meters its own spend via Lago). When a price
   * becomes configurable here, compute costUsd from the captured tokens.
   * TODO(cost): wire a configurable $/1k-token price (env) once Brigade exposes
   * the model + token counts on the chat reply, then set costUsd.
   */
  private captureTurn(
    user: User & Partial<WithWorkspaceClaim>,
    body: { projectId?: string },
    data: any,
  ): void {
    if (!this.agentEvents) return;
    try {
      const usage = data?.usage ?? {};
      const tokensIn = firstNum(
        usage.prompt_tokens,
        usage.input_tokens,
        usage.promptTokens,
        data?.tokens_in,
      );
      const tokensOut = firstNum(
        usage.completion_tokens,
        usage.output_tokens,
        usage.completionTokens,
        data?.tokens_out,
      );

      void this.agentEvents.recordForUser(user, {
        actorKind: AgentActorKind.ASSISTANT,
        actorKey: 'assistant',
        actorLabel: 'Project Assistant',
        via: AgentVia.ASSISTANT,
        action: 'assistant.turn',
        projectId: body.projectId ?? null,
        tokensIn,
        tokensOut,
        // costUsd intentionally null — see method doc (no price wired here).
        costUsd: null,
        details: data?.id || data?.messageId ? { messageId: data.id || data.messageId } : null,
      });
    } catch (err) {
      this.logger.debug(`assistant turn capture skipped: ${(err as Error).message}`);
    }
  }
}

/** First finite number among the candidates, else null (Brigade usage probing). */
function firstNum(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}
