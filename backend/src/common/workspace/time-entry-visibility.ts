import { Prisma, User, UserRole } from '@prisma/client';

/**
 * Workspace + role scoping for TimeEntry queries. Mirrors the project
 * visibility model (see buildVisibilityFilter in mcp.tools.ts) but expressed
 * against TimeEntry, and always pinned to the active workspace.
 *
 *   ADMIN / MANAGER : every entry in the workspace
 *   STAFF           : their own entries, plus entries on projects they
 *                     created or are assigned to
 *   CLIENT          : entries on projects where they are the linked contact
 *                     (read-only; cost/margin is additionally redacted on the
 *                     way out — see redactCost*)
 */
export function buildTimeEntryVisibilityFilter(
  user: Pick<User, 'id' | 'role'>,
  workspaceId: string,
): Prisma.TimeEntryWhereInput {
  const base: Prisma.TimeEntryWhereInput = { workspaceId };

  if (user.role === UserRole.ADMIN || user.role === UserRole.MANAGER) {
    return base;
  }

  if (user.role === UserRole.STAFF) {
    return {
      ...base,
      OR: [
        { userId: user.id },
        { project: { OR: [{ assignedToId: user.id }, { createdById: user.id }] } },
      ],
    };
  }

  // CLIENT — only entries on their own projects, never others'.
  return {
    ...base,
    project: { OR: [{ contactId: user.id }, { contact: { userId: user.id } }] },
  };
}

// Fields that reveal internal cost / margin. CLIENT users must NEVER see them.
const COST_FIELDS = ['costRateApplied'] as const;

/**
 * Strip cost/margin fields from a time entry when the viewer is a CLIENT.
 * Returns a shallow copy; non-CLIENT roles get the object unchanged.
 */
export function redactCost<T extends Record<string, any>>(entry: T, role: UserRole): T {
  if (role !== UserRole.CLIENT || !entry) return entry;
  const copy: Record<string, any> = { ...entry };
  for (const f of COST_FIELDS) delete copy[f];
  return copy as T;
}

export function redactCostMany<T extends Record<string, any>>(entries: T[], role: UserRole): T[] {
  if (role !== UserRole.CLIENT) return entries;
  return entries.map((e) => redactCost(e, role));
}
