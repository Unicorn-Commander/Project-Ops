/**
 * Port every forge adapter implements.
 *
 * Mirrors the AccountingOpsPort style (token + abstract class): services depend
 * on the port, Nest binds a concrete adapter (or a multi-provider registry) later.
 *
 * Design scaffold only — no HTTP. Live Forgejo wiring is Phase 1.
 * Spec: docs/designs/GIT-FORGE-INTEGRATION.md §7.
 */

import {
  GitCommit,
  GitForgeConnectionTestResult,
  GitForgeCredentials,
  GitForgeProviderKind,
  GitPullRequest,
  GitRepoRef,
  GitWebhookEvent,
} from './types';

export const GIT_FORGE_PROVIDER = 'GIT_FORGE_PROVIDER';

export interface ListCommitsOptions {
  branch?: string;
  since?: string; // ISO-8601
  limit?: number;
}

export interface ListPullRequestsOptions {
  state?: 'open' | 'closed' | 'all';
  limit?: number;
}

export abstract class GitForgeProvider {
  abstract readonly kind: GitForgeProviderKind;

  /**
   * Lightweight auth + identity check. Must not be called without a token.
   * Implementations should hit a cheap endpoint (e.g. GET /api/v1/user).
   */
  abstract testConnection(
    creds: GitForgeCredentials,
  ): Promise<GitForgeConnectionTestResult>;

  abstract listCommits(
    creds: GitForgeCredentials,
    repo: GitRepoRef,
    opts?: ListCommitsOptions,
  ): Promise<GitCommit[]>;

  abstract listPullRequests(
    creds: GitForgeCredentials,
    repo: GitRepoRef,
    opts?: ListPullRequestsOptions,
  ): Promise<GitPullRequest[]>;

  /**
   * Verify signature (when secret provided) and normalize the forge payload.
   * Returns null when the event type is ignored or verification fails.
   */
  abstract parseWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer | string,
    webhookSecret: string | null,
  ): GitWebhookEvent | null;
}
