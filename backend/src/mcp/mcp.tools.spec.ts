/**
 * Targeted RBAC tests for the MCP layer.
 *
 * These cover the load-bearing access-control surfaces:
 *
 *   - buildVisibilityFilter: the Prisma `where` fragment that scopes every
 *     project-related list query to what the calling user is allowed to see.
 *   - assertCanWrite: the role gate at the top of every write tool.
 *
 * Both are pure functions of (user) — no DB, no mocks needed. A regression
 * here would silently widen access; that's the bug class these tests exist
 * to prevent.
 */

import { User, UserRole } from '@prisma/client';
import { ProjectOpsTools, buildVisibilityFilter } from './mcp.tools';

const baseUser = (overrides: Partial<User>): User =>
  ({
    id: 'user-id',
    email: 'user@example.com',
    username: 'user',
    firstName: 'Test',
    lastName: 'User',
    role: UserRole.STAFF,
    keycloakId: null,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    password: null,
    forcePasswordChange: false,
    ...overrides,
  }) as User;

describe('buildVisibilityFilter', () => {
  it('returns no scope (sees everything) for ADMIN', () => {
    const filter = buildVisibilityFilter(baseUser({ role: UserRole.ADMIN }));
    expect(filter).toEqual({});
  });

  it('returns no scope (sees everything) for MANAGER', () => {
    const filter = buildVisibilityFilter(baseUser({ role: UserRole.MANAGER }));
    expect(filter).toEqual({});
  });

  it('limits STAFF to projects they own or are assigned to', () => {
    const filter = buildVisibilityFilter(
      baseUser({ id: 'staff-1', role: UserRole.STAFF }),
    );
    expect(filter).toEqual({
      OR: [{ assignedToId: 'staff-1' }, { createdById: 'staff-1' }],
    });
  });

  it('limits CLIENT to projects they are the contact for', () => {
    const filter = buildVisibilityFilter(
      baseUser({ id: 'client-1', role: UserRole.CLIENT }),
    );
    expect(filter).toEqual({
      OR: [
        { contactId: 'client-1' },
        { contact: { userId: 'client-1' } },
      ],
    });
  });

  it('does NOT leak STAFF visibility shape to CLIENT — filter shapes differ', () => {
    // Cheap regression check: if someone collapses both branches by accident,
    // both roles would suddenly see by-assignee projects, which would be
    // a privilege escalation for CLIENT users.
    const staffFilter = buildVisibilityFilter(
      baseUser({ id: 'u1', role: UserRole.STAFF }),
    );
    const clientFilter = buildVisibilityFilter(
      baseUser({ id: 'u1', role: UserRole.CLIENT }),
    );
    expect(staffFilter).not.toEqual(clientFilter);
  });
});

describe('ProjectOpsTools.assertCanWrite', () => {
  // We don't exercise any DB-touching code, just the gate, so a stub
  // PrismaService / MinioService is enough.
  const tools = new ProjectOpsTools(
    {} as any,
    {} as any,
    { log: () => {}, warn: () => {} },
  );

  it.each([UserRole.ADMIN, UserRole.MANAGER, UserRole.STAFF])(
    'allows %s to write',
    (role) => {
      expect(() =>
        tools.assertCanWrite(baseUser({ role })),
      ).not.toThrow();
    },
  );

  it('rejects CLIENT writes', () => {
    expect(() =>
      tools.assertCanWrite(baseUser({ role: UserRole.CLIENT })),
    ).toThrow(/Read-only role/);
  });
});

describe('ProjectOpsTools.addTaskComment — domain event', () => {
  // Minimal WorkspaceContextService stub: resolveAuthorized hands back the
  // active workspace, runForUser runs the callback against a fake tx (no DB).
  // This pins the MCP path's `task.comment.created` emit so MCP-posted task
  // comments fan out @mentions identically to the REST TasksService.addComment.
  const WS_ID = 'ws-1';

  function makeTools(overrides?: {
    taskFindFirst?: () => Promise<any>;
    taskCommentCreate?: () => Promise<any>;
  }) {
    const emit = jest.fn();
    const events = { emit } as any;
    const tx = {
      task: {
        findFirst:
          overrides?.taskFindFirst ??
          (async () => ({ id: 'task1', projectId: 'p1' })),
      },
      taskComment: {
        create:
          overrides?.taskCommentCreate ??
          (async () => ({
            id: 'comment1',
            content: 'hey @bob',
            createdAt: new Date(),
            author: { firstName: 'A', lastName: 'B' },
          })),
      },
    };
    const workspace = {
      resolveAuthorized: async () => WS_ID,
      runForUser: async (_user: User, fn: (t: any) => Promise<any>) =>
        fn(tx),
    } as any;
    const tools = new ProjectOpsTools(
      {} as any, // prisma (unused — runForUser stub supplies tx)
      {} as any, // minio
      { log: () => {}, warn: () => {} },
      undefined, // triage
      undefined, // tt
      null, // bearerToken
      workspace,
      events,
    );
    return { tools, emit };
  }

  const user = baseUser({ id: 'u1', role: UserRole.STAFF });

  it('emits task.comment.created with the expected payload after commit', async () => {
    const { tools, emit } = makeTools();

    await tools.addTaskComment(user, { taskId: 'task1', content: 'hey @bob' });

    // Byte-for-byte the same event + payload shape TasksService.addComment emits.
    expect(emit).toHaveBeenCalledWith('task.comment.created', {
      workspaceId: WS_ID,
      taskId: 'task1',
      commentId: 'comment1',
      authorId: 'u1',
      content: 'hey @bob',
    });
  });

  it('does NOT emit if the task is missing (create never runs)', async () => {
    const { tools, emit } = makeTools({ taskFindFirst: async () => null });

    await expect(
      tools.addTaskComment(user, { taskId: 'missing', content: 'x' }),
    ).rejects.toThrow(/Task not found/);
    expect(emit).not.toHaveBeenCalled();
  });
});
