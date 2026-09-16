import { SetMetadata } from '@nestjs/common';

export const WORKSPACE_WRITE_POLICY = 'workspaceWritePolicy';
/** Explicit reviewed exceptions to the MEMBER floor; membership is still required. */
export type WorkspaceWritePolicy = 'personal' | 'client-portal' | 'mcp';
export const WorkspaceWriteException = (policy: WorkspaceWritePolicy) =>
  SetMetadata(WORKSPACE_WRITE_POLICY, policy);
