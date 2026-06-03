import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_WORKSPACE_FALLBACK,
  resolveWorkspaceId,
  WithWorkspaceClaim,
} from './workspace.util';

/**
 * Injectable wrapper around the workspace resolution seam, for services and
 * the REST layer. See workspace.util.ts for the full rationale.
 */
@Injectable()
export class WorkspaceContextService {
  constructor(private readonly config: ConfigService) {}

  get defaultWorkspaceId(): string {
    return this.config.get<string>(
      'DEFAULT_WORKSPACE_ID',
      DEFAULT_WORKSPACE_FALLBACK,
    );
  }

  /** Resolve the active workspace id for the given (claim-augmented) user. */
  resolve(user: Partial<WithWorkspaceClaim> | null | undefined): string {
    return resolveWorkspaceId(user, this.defaultWorkspaceId);
  }
}
