import { ForbiddenException } from '@nestjs/common';

export const NO_WORKSPACE_ACCESS_RESPONSE = {
  error: 'no_workspace_access',
  message:
    'Your account is verified but has no workspace in Project-Ops yet. Ask your workspace admin for an invite.',
} as const;

/** A verified identity that has not been provisioned into a Project-Ops workspace. */
export class NoWorkspaceAccessException extends ForbiddenException {
  constructor() {
    super(NO_WORKSPACE_ACCESS_RESPONSE);
  }
}
