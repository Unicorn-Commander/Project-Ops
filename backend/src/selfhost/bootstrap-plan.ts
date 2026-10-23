import { MembershipStatus, UserRole, WorkspaceRole } from '@prisma/client';

export interface BootstrapIdentity {
  adminEmail: string;
  workspaceId: string;
}

/** No database, randomness, logging, or plaintext password in the write plan. */
export function bootstrapRecords(
  identity: BootstrapIdentity,
  userId: string,
  passwordHash: string,
) {
  if (!/^admin-[a-f0-9]{24}@example\.invalid$/.test(identity.adminEmail)) {
    throw new Error('Invalid generated admin identity');
  }
  if (![identity.workspaceId, userId].every((id) => /^[a-f0-9-]{36}$/.test(id))) {
    throw new Error('Invalid bootstrap identifier');
  }
  if (!/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) {
    throw new Error('Bootstrap requires a bcrypt hash with cost 12');
  }
  return {
    user: {
      id: userId,
      email: identity.adminEmail,
      username: identity.adminEmail.split('@')[0],
      firstName: 'Local',
      lastName: 'Administrator',
      role: UserRole.ADMIN,
      password: passwordHash,
      isActive: true,
      forcePasswordChange: false,
    },
    workspace: {
      id: identity.workspaceId,
      slug: 'selfhost',
      displayName: 'My workspace',
    },
    membership: {
      userKey: userId,
      workspaceId: identity.workspaceId,
      role: WorkspaceRole.OWNER,
      status: MembershipStatus.ACTIVE,
      isDefault: true,
    },
  };
}

export function bootstrapAction(userCount: number, workspaceCount: number, ownerExists: boolean) {
  if (ownerExists) return 'already-initialized';
  if (userCount !== 0 || workspaceCount !== 0) {
    throw new Error('Bootstrap requires an empty installation; existing data will not be changed');
  }
  return 'create';
}

export function requireBootstrapTerminal(inputIsTTY: boolean, outputIsTTY: boolean) {
  if (!inputIsTTY || !outputIsTTY) {
    throw new Error('Bootstrap requires an interactive terminal; do not redirect its output');
  }
}
