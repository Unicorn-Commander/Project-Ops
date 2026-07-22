/**
 * Forgejo adapter — stub (Phase 0/design).
 *
 * Hard rules for this scaffold:
 *   - NEVER open a network connection without a non-empty accessToken + baseUrl.
 *   - Prefer throwing GitForgeNotConfiguredError over silent empty success when
 *     the caller expected a live call but forgot credentials.
 *
 * Phase 1 replaces the bodies of testConnection / listCommits / listPullRequests
 * with real REST calls against `{baseUrl}/api/v1/...` and implements HMAC
 * verification in parseWebhook (Forgejo/Gitea X-Gitea-Signature / similar).
 *
 * Spec: docs/designs/GIT-FORGE-INTEGRATION.md
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  GitForgeProvider,
  ListCommitsOptions,
  ListPullRequestsOptions,
} from '../git-forge.provider';
import {
  GitCommit,
  GitForgeConnectionTestResult,
  GitForgeCredentials,
  GitForgeNotConfiguredError,
  GitForgeProviderKind,
  GitPullRequest,
  GitRepoRef,
  GitWebhookEvent,
} from '../types';

@Injectable()
export class ForgejoAdapter extends GitForgeProvider {
  readonly kind: GitForgeProviderKind = 'FORGEJO';
  private readonly logger = new Logger(ForgejoAdapter.name);

  async testConnection(
    creds: GitForgeCredentials,
  ): Promise<GitForgeConnectionTestResult> {
    this.assertCallable(creds);
    // Phase 1: GET {baseUrl}/api/v1/user with Authorization: token <pat>
    this.logger.debug(
      `Forgejo testConnection stub (baseUrl=${this.safeBase(creds.baseUrl)}) — no network`,
    );
    return {
      ok: false,
      message:
        'Forgejo adapter is a design stub: network calls are not enabled yet. ' +
        'Phase 1 will validate the PAT against GET /api/v1/user.',
    };
  }

  async listCommits(
    creds: GitForgeCredentials,
    repo: GitRepoRef,
    _opts?: ListCommitsOptions,
  ): Promise<GitCommit[]> {
    this.assertCallable(creds);
    this.assertRepo(repo);
    this.logger.debug(
      `Forgejo listCommits stub ${repo.owner}/${repo.repo} — no network`,
    );
    return [];
  }

  async listPullRequests(
    creds: GitForgeCredentials,
    repo: GitRepoRef,
    _opts?: ListPullRequestsOptions,
  ): Promise<GitPullRequest[]> {
    this.assertCallable(creds);
    this.assertRepo(repo);
    this.logger.debug(
      `Forgejo listPullRequests stub ${repo.owner}/${repo.repo} — no network`,
    );
    return [];
  }

  parseWebhook(
    _headers: Record<string, string | string[] | undefined>,
    _rawBody: Buffer | string,
    _webhookSecret: string | null,
  ): GitWebhookEvent | null {
    // Phase 1: verify HMAC, map push / pull_request / ping.
    // Until then refuse to interpret payloads (fail closed).
    this.logger.debug('Forgejo parseWebhook stub — ignoring payload');
    return null;
  }

  // ── guards ────────────────────────────────────────────────────────────────

  private assertCallable(creds: GitForgeCredentials): void {
    if (!creds?.accessToken?.trim()) {
      throw new GitForgeNotConfiguredError(
        'Forgejo adapter refused call: accessToken is empty',
      );
    }
    if (!creds?.baseUrl?.trim()) {
      throw new GitForgeNotConfiguredError(
        'Forgejo adapter refused call: baseUrl is empty',
      );
    }
    if (creds.provider !== 'FORGEJO' && creds.provider !== 'GITEA') {
      // Gitea is API-compatible enough that Phase 3 may share this class;
      // reject GitHub here so mis-wiring fails loud.
      throw new GitForgeNotConfiguredError(
        `Forgejo adapter cannot serve provider=${creds.provider}`,
      );
    }
  }

  private assertRepo(repo: GitRepoRef): void {
    if (!repo?.owner?.trim() || !repo?.repo?.trim()) {
      throw new GitForgeNotConfiguredError(
        'Forgejo adapter refused call: owner/repo required',
      );
    }
  }

  private safeBase(baseUrl: string): string {
    try {
      const u = new URL(baseUrl);
      return u.origin;
    } catch {
      return '(invalid-baseUrl)';
    }
  }
}
