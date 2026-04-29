/**
 * Proxy from Project Ops to Unicorn Brigade's /agents/{id}/chat endpoint.
 *
 * Project Ops users authenticate against this backend with their JWT.
 * We then call Brigade with a service-level API key, but pass the user's
 * stable identifier as `user_id` so Brigade scopes per-user memory correctly
 * (Aaron's chat history isn't shared with Shafen, etc).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { ChatMessageDto } from './dto/chat.dto';

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(private readonly config: ConfigService) {}

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

    return {
      content,
      messageId: data.id || data.messageId,
    };
  }
}
