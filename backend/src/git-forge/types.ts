/**
 * Git-forge integration — shared types (design scaffold).
 *
 * See docs/designs/GIT-FORGE-INTEGRATION.md. These types are pure and have no
 * Nest/Prisma dependency so adapters and future services can share them without
 * pulling in the full module graph.
 *
 * No network I/O lives here.
 */

/** Supported forge backends. Forgejo is Phase 1; Gitea/GitHub are Phase 3. */
export type GitForgeProviderKind = 'FORGEJO' | 'GITEA' | 'GITHUB';

/** How PO authenticates to the forge (v1 = personal/access token only). */
export type GitForgeAuthType = 'PAT' | 'GITHUB_APP';

/**
 * Credentials handed to an adapter for a single outbound call.
 * `accessToken` is plaintext only in-memory after decrypt — never log it.
 */
export interface GitForgeCredentials {
  provider: GitForgeProviderKind;
  /** Origin only, e.g. https://git.unicorncommander.ai (no trailing slash). */
  baseUrl: string;
  authType: GitForgeAuthType;
  /** Decrypted token. Adapters MUST no-op / throw if missing. */
  accessToken: string;
}

export interface GitRepoRef {
  owner: string;
  repo: string;
  defaultBranch?: string;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  /** First line of message. */
  subject: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: string; // ISO-8601
  htmlUrl: string | null;
}

export type GitPullRequestState = 'open' | 'closed' | 'merged';

export interface GitPullRequest {
  externalId: string;
  number: number;
  title: string;
  state: GitPullRequestState;
  authorName: string | null;
  sourceBranch: string | null;
  targetBranch: string | null;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  htmlUrl: string | null;
}

export interface GitForgeConnectionTestResult {
  ok: boolean;
  /** Forge login / bot name when ok. */
  login?: string;
  message: string;
}

export type GitWebhookEventKind = 'push' | 'pull_request' | 'ping' | 'unknown';

export interface GitWebhookEvent {
  kind: GitWebhookEventKind;
  externalEventId: string | null;
  repo: GitRepoRef | null;
  /** Normalized commits for push events. */
  commits?: GitCommit[];
  pullRequest?: GitPullRequest;
  rawAction?: string;
}

/** Staff delivery strip (see design §3.3). */
export interface GitDeliveryProgress {
  commitsLast7d: number;
  commitsLast30d: number;
  openPrCount: number;
  lastActivityAt: string | null;
  headline: string;
}

/**
 * CLIENT portal projection — no SHAs, no open PR count, no author emails.
 * Built only from activities / links marked portal-safe.
 */
export interface PortalDeliveryProgress {
  commitsLast7d: number;
  commitsLast30d: number;
  lastActivityAt: string | null;
  headline: string;
}

export class GitForgeNotConfiguredError extends Error {
  constructor(message = 'Git forge credentials are not configured') {
    super(message);
    this.name = 'GitForgeNotConfiguredError';
  }
}

export class GitForgeRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'GitForgeRequestError';
  }
}
