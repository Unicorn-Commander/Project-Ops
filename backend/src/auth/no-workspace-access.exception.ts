import { ForbiddenException } from '@nestjs/common';

/** Shown when a verified token has no Project-Ops access. RFC 6750 insufficient_scope, not invalid_token. */
export const NO_PROJECT_OPS_ACCESS_DESCRIPTION =
  'You are signed in but have no Project-Ops access. Contact your administrator.';

export const NO_WORKSPACE_ACCESS_RESPONSE = {
  error: 'no_workspace_access',
  message: NO_PROJECT_OPS_ACCESS_DESCRIPTION,
} as const;

/** A verified identity that has not been provisioned into a Project-Ops workspace. */
export class NoWorkspaceAccessException extends ForbiddenException {
  constructor() {
    super(NO_WORKSPACE_ACCESS_RESPONSE);
  }
}
