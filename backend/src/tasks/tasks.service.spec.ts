import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TaskDependencyType, UserRole } from '@prisma/client';
import { DependencyDirection } from './dto/create-task-dependency.dto';
import { TaskSortBy, TaskSortDir } from './dto/query-tasks.dto';
import { resolveField } from '../automations/automation-conditions';

/**
 * Unit tests for the Push B task features: subtasks, dependency cycle
 * prevention, list search/sort/window, and the `task.comment.created` emit.
 *
 * Mirrors the suite test style (see comments.service.spec.ts): the service is
 * constructed with hand-rolled mocks and `workspaceContext.runForUser` simply
 * invokes the callback with a fake tx, so we exercise the real method bodies
 * without a DB.
 */

const user = { id: 'u1', email: 'a@x.co', role: 'ADMIN' } as any;

/**
 * Build a service whose fake tx is backed by the supplied stubs.
 * `taskFindUnique` resolves task-existence reads; `depFindMany` drives the
 * cycle-walk (called with `{ where: { successorId: { in: [...] } } }`).
 */
function makeService(opts: {
  taskFindUnique?: (args: any) => Promise<any>;
  taskFindMany?: (args: any) => Promise<any[]>;
  taskCount?: () => Promise<number>;
  taskCreate?: (args: any) => Promise<any>;
  taskUpdate?: (args: any) => Promise<any>;
  userFindUnique?: (args: any) => Promise<any>;
  taskCommentCreate?: (args: any) => Promise<any>;
  taskCommentFindUnique?: (args: any) => Promise<any>;
  taskCommentFindMany?: (args: any) => Promise<any[]>;
  taskCommentUpdate?: (args: any) => Promise<any>;
  taskCommentDelete?: (args: any) => Promise<any>;
  projectFindUnique?: (args: any) => Promise<any>;
  depFindMany?: (args: any) => Promise<any[]>;
  depFindUnique?: (args: any) => Promise<any>;
  depCreate?: (args: any) => Promise<any>;
  depDelete?: (args: any) => Promise<any>;
  validateValues?: (tx: any, ws: string, entity: string, incoming: any) => Promise<any>;
}) {
  const tx = {
    project: {
      findUnique: jest.fn(opts.projectFindUnique ?? (async () => ({ id: 'p1' }))),
    },
    user: {
      findUnique: jest.fn(opts.userFindUnique ?? (async () => ({ id: 'u-assignee' }))),
    },
    task: {
      findUnique: jest.fn(opts.taskFindUnique ?? (async () => ({ id: 't' }))),
      findMany: jest.fn(opts.taskFindMany ?? (async () => [])),
      count: jest.fn(opts.taskCount ?? (async () => 0)),
      create: jest.fn(opts.taskCreate ?? (async (a: any) => ({ id: 'new', ...a.data }))),
      update: jest.fn(opts.taskUpdate ?? (async (a: any) => ({ id: a.where.id, ...a.data }))),
    },
    taskComment: {
      create: jest.fn(
        opts.taskCommentCreate ?? (async () => ({ id: 'c1', content: 'hello', author: {} })),
      ),
      findUnique: jest.fn(
        opts.taskCommentFindUnique ?? (async () => ({ id: 'c1', authorId: 'u1', taskId: 'task1' })),
      ),
      findMany: jest.fn(opts.taskCommentFindMany ?? (async () => [])),
      update: jest.fn(
        opts.taskCommentUpdate ?? (async (a: any) => ({ id: a.where.id, ...a.data, author: {} })),
      ),
      delete: jest.fn(opts.taskCommentDelete ?? (async () => ({}))),
    },
    taskDependency: {
      findMany: jest.fn(opts.depFindMany ?? (async () => [])),
      findUnique: jest.fn(opts.depFindUnique ?? (async () => null)),
      create: jest.fn(opts.depCreate ?? (async (a: any) => ({ id: 'd1', ...a.data }))),
      delete: jest.fn(opts.depDelete ?? (async () => ({}))),
    },
  };

  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };
  const emit = jest.fn();
  const customFields = opts.validateValues
    ? { validateValues: jest.fn(opts.validateValues) }
    : undefined;

  const svc = new TasksService(
    {} as any, // prisma
    workspaceContext as any,
    {} as any, // emailService
    { get: (_k: string, d: any) => d } as any, // configService
    { emit } as any, // eventEmitter
    customFields as any, // CustomFieldsValidator (optional)
  );

  return { svc, tx, emit, customFields };
}

describe('TasksService.createInTx — subtask parent validation', () => {
  it('rejects a parent task that does not exist', async () => {
    // project resolves (default); parent lookup (tx.task.findUnique) returns null.
    const { svc, tx } = makeService({ taskFindUnique: async () => null });

    await expect(
      svc.createInTx(tx as any, 'ws1', user, {
        projectId: 'p1',
        title: 'child',
        parentTaskId: 'missing',
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a parent in a different project', async () => {
    const { svc, tx } = makeService({
      taskFindUnique: async () => ({ id: 'parent', projectId: 'OTHER' }),
    });

    await expect(
      svc.createInTx(tx as any, 'ws1', user, {
        projectId: 'p1',
        title: 'child',
        parentTaskId: 'parent',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a parent in the same project', async () => {
    const { svc, tx } = makeService({
      taskFindUnique: async () => ({ id: 'parent', projectId: 'p1' }),
    });

    await expect(
      svc.createInTx(tx as any, 'ws1', user, {
        projectId: 'p1',
        title: 'child',
        parentTaskId: 'parent',
      } as any),
    ).resolves.toBeDefined();
    expect(tx.task.create).toHaveBeenCalled();
  });
});

describe('TasksService.findAll — search / window / sort', () => {
  it('builds an ILIKE OR over title+description and a due-date window', async () => {
    const { svc, tx } = makeService({});
    await svc.findAll('ws1', user, {
      search: 'design',
      dueAfter: '2026-01-01T00:00:00Z',
      dueBefore: '2026-12-31T00:00:00Z',
    });
    const args = (tx.task.findMany as jest.Mock).mock.calls[0][0];
    expect(args.where.OR).toEqual([
      { title: { contains: 'design', mode: 'insensitive' } },
      { description: { contains: 'design', mode: 'insensitive' } },
    ]);
    expect(args.where.dueDate.gte).toEqual(new Date('2026-01-01T00:00:00Z'));
    expect(args.where.dueDate.lt).toEqual(new Date('2026-12-31T00:00:00Z'));
  });

  it('honors explicit sortBy/sortDir with a stable id tiebreaker', async () => {
    const { svc, tx } = makeService({});
    await svc.findAll('ws1', user, {
      sortBy: TaskSortBy.dueDate,
      sortDir: TaskSortDir.asc,
    });
    const args = (tx.task.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual([{ dueDate: 'asc' }, { id: 'asc' }]);
  });

  it('keeps the historical default order when no sort is given', async () => {
    const { svc, tx } = makeService({});
    await svc.findAll('ws1', user, {});
    const args = (tx.task.findMany as jest.Mock).mock.calls[0][0];
    expect(args.orderBy).toEqual([{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'desc' }]);
  });

  it('clamps an oversized take to 100 and filters by parentTaskId', async () => {
    const { svc, tx } = makeService({});
    await svc.findAll('ws1', user, { take: 100000, parentTaskId: 'parent-1' });
    const args = (tx.task.findMany as jest.Mock).mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.where.parentTaskId).toBe('parent-1');
    expect(args.include._count.select.subtasks).toBe(true);
  });
});

describe('TasksService.addDependency — cycle prevention', () => {
  it('rejects a self-dependency', async () => {
    const { svc } = makeService({
      taskFindUnique: async () => ({ id: 't1' }),
    });
    await expect(
      svc.addDependency('ws1', user, 't1', {
        taskId: 't1',
        direction: DependencyDirection.DEPENDS_ON,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an edge that would close a cycle', async () => {
    // Existing edge: A depends on B (predecessor B → successor A), i.e. for
    // successor A the predecessor is B. Now we try to make B depend on A
    // (DEPENDS_ON on URL task B, other = A → predecessor A → successor B).
    // Walk from predecessor A following successor→predecessors: A's parents...
    // we must reach successor B. Existing edges where successorId === A yield B.
    const { svc } = makeService({
      taskFindUnique: async () => ({ id: 'x' }),
      depFindMany: async (args: any) => {
        const ids: string[] = args.where.successorId.in;
        if (ids.includes('A')) return [{ predecessorId: 'B' }];
        return [];
      },
    });
    await expect(
      svc.addDependency('ws1', user, 'B', {
        taskId: 'A',
        direction: DependencyDirection.DEPENDS_ON,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows a non-cyclic edge and stamps workspace + creator', async () => {
    const { svc, tx } = makeService({
      taskFindUnique: async () => ({ id: 'x' }),
      depFindMany: async () => [], // no existing edges → no cycle
    });
    await svc.addDependency('ws1', user, 'B', {
      taskId: 'A',
      direction: DependencyDirection.DEPENDS_ON,
      type: TaskDependencyType.START_TO_START,
    } as any);
    const createArgs = (tx.taskDependency.create as jest.Mock).mock.calls[0][0];
    // DEPENDS_ON: URL task B is successor, other A is predecessor.
    expect(createArgs.data.predecessorId).toBe('A');
    expect(createArgs.data.successorId).toBe('B');
    expect(createArgs.data.workspaceId).toBe('ws1');
    expect(createArgs.data.createdById).toBe('u1');
    expect(createArgs.data.type).toBe(TaskDependencyType.START_TO_START);
  });

  it('maps BLOCKS direction to (predecessor=urlTask, successor=other)', async () => {
    const { svc, tx } = makeService({
      taskFindUnique: async () => ({ id: 'x' }),
      depFindMany: async () => [],
    });
    await svc.addDependency('ws1', user, 'B', {
      taskId: 'A',
      direction: DependencyDirection.BLOCKS,
    } as any);
    const createArgs = (tx.taskDependency.create as jest.Mock).mock.calls[0][0];
    expect(createArgs.data.predecessorId).toBe('B');
    expect(createArgs.data.successorId).toBe('A');
  });
});

describe('TasksService.removeDependency', () => {
  it('404s when the dependency is not attached to the URL task', async () => {
    const { svc } = makeService({
      depFindUnique: async () => ({
        id: 'd1',
        predecessorId: 'other1',
        successorId: 'other2',
      }),
    });
    await expect(svc.removeDependency('ws1', user, 'taskX', 'd1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes when the dependency belongs to the URL task', async () => {
    const { svc, tx } = makeService({
      depFindUnique: async () => ({
        id: 'd1',
        predecessorId: 'taskX',
        successorId: 'other',
      }),
    });
    await svc.removeDependency('ws1', user, 'taskX', 'd1');
    expect(tx.taskDependency.delete).toHaveBeenCalledWith({ where: { id: 'd1' } });
  });
});

describe('TasksService.addComment — domain event', () => {
  it('emits task.comment.created with the expected payload after commit', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 'task1' }),
      taskCommentCreate: async () => ({
        id: 'comment1',
        content: 'hey @bob',
        author: { id: 'u1' },
      }),
    });

    await svc.addComment('ws1', user, 'task1', { content: 'hey @bob' } as any);

    expect(emit).toHaveBeenCalledWith('task.comment.created', {
      workspaceId: 'ws1',
      taskId: 'task1',
      commentId: 'comment1',
      authorId: 'u1',
      content: 'hey @bob',
    });
  });

  it('does NOT emit if the task is missing (create never runs)', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => null,
    });
    await expect(
      svc.addComment('ws1', user, 'missing', { content: 'x' } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('TasksService.updateComment / removeComment — ownership', () => {
  it('author can update their own comment', async () => {
    const { svc, tx } = makeService({
      taskCommentFindUnique: async () => ({ id: 'c1', authorId: 'u1', taskId: 't1' }),
      taskCommentUpdate: async (a: any) => ({
        id: 'c1',
        content: a.data.content,
        author: { id: 'u1' },
      }),
    });
    const author = { id: 'u1', role: UserRole.STAFF } as any;
    const out = await svc.updateComment('ws1', author, 'c1', 'edited');
    expect(out.content).toBe('edited');
    expect(tx.taskComment.update).toHaveBeenCalled();
  });

  it('non-author STAFF cannot update', async () => {
    const { svc } = makeService({
      taskCommentFindUnique: async () => ({ id: 'c1', authorId: 'other', taskId: 't1' }),
    });
    await expect(
      svc.updateComment('ws1', { id: 'u1', role: UserRole.STAFF } as any, 'c1', 'x'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ADMIN can update any comment', async () => {
    const { svc } = makeService({
      taskCommentFindUnique: async () => ({ id: 'c1', authorId: 'other', taskId: 't1' }),
      taskCommentUpdate: async () => ({ id: 'c1', content: 'admin-edit', author: {} }),
    });
    const out = await svc.updateComment(
      'ws1',
      { id: 'admin', role: UserRole.ADMIN } as any,
      'c1',
      'admin-edit',
    );
    expect(out.content).toBe('admin-edit');
  });

  it("MANAGER can delete but not update others' comments", async () => {
    const { svc, tx } = makeService({
      taskCommentFindUnique: async () => ({ id: 'c1', authorId: 'other', taskId: 't1' }),
    });
    const manager = { id: 'm1', role: UserRole.MANAGER } as any;
    await expect(svc.updateComment('ws1', manager, 'c1', 'nope')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const del = await svc.removeComment('ws1', manager, 'c1');
    expect(del).toEqual({ deleted: true, commentId: 'c1', taskId: 't1' });
    expect(tx.taskComment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });

  it('non-author STAFF cannot delete', async () => {
    const { svc } = makeService({
      taskCommentFindUnique: async () => ({ id: 'c1', authorId: 'other', taskId: 't1' }),
    });
    await expect(
      svc.removeComment('ws1', { id: 'u1', role: UserRole.STAFF } as any, 'c1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 when comment missing', async () => {
    const { svc } = makeService({
      taskCommentFindUnique: async () => null,
    });
    await expect(svc.updateComment('ws1', user, 'missing', 'x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(svc.removeComment('ws1', user, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Wave 2: domain events
// ───────────────────────────────────────────────────────────────────────────

function emittedPayload(emit: jest.Mock, name: string) {
  const call = emit.mock.calls.find((c) => c[0] === name);
  return call ? call[1] : undefined;
}

describe('TasksService.create — task.created / task.assigned events', () => {
  it('emits task.created after commit with the documented payload', async () => {
    const { svc, emit } = makeService({
      taskCreate: async () => ({ id: 'task1', projectId: 'p1', assignedToId: null }),
    });
    await svc.create('ws1', user, { projectId: 'p1', title: 'x' } as any);
    expect(emittedPayload(emit, 'task.created')).toEqual({
      workspaceId: 'ws1',
      taskId: 'task1',
      projectId: 'p1',
      actorId: 'u1',
      task: { id: 'task1', projectId: 'p1', assignedToId: null },
    });
    expect(emittedPayload(emit, 'task.assigned')).toBeUndefined();
  });

  it('also emits task.assigned when created with an assignee', async () => {
    const { svc, emit } = makeService({
      taskCreate: async () => ({ id: 'task1', projectId: 'p1', assignedToId: 'u9' }),
    });
    await svc.create('ws1', user, {
      projectId: 'p1',
      title: 'x',
      assignedToId: 'u9',
    } as any);
    expect(emittedPayload(emit, 'task.assigned')).toEqual({
      workspaceId: 'ws1',
      taskId: 'task1',
      assignedToId: 'u9',
      actorId: 'u1',
      task: { id: 'task1', projectId: 'p1', assignedToId: 'u9' },
    });
  });
});

describe('TasksService.updateStatus — status_changed / completed events', () => {
  it('emits status_changed (and completed) when transitioning to COMPLETED', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'IN_PROGRESS', projectId: 'p1' }),
      taskUpdate: async () => ({ id: 't1', status: 'COMPLETED', projectId: 'p1' }),
    });
    await svc.updateStatus('ws1', user, 't1', 'COMPLETED' as any);

    expect(emittedPayload(emit, 'task.status_changed')).toEqual({
      workspaceId: 'ws1',
      taskId: 't1',
      projectId: 'p1',
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      actorId: 'u1',
      task: { id: 't1', status: 'COMPLETED', projectId: 'p1' },
    });
    expect(emittedPayload(emit, 'task.completed')).toEqual({
      workspaceId: 'ws1',
      taskId: 't1',
      projectId: 'p1',
      actorId: 'u1',
      task: { id: 't1', status: 'COMPLETED', projectId: 'p1' },
    });
  });

  it('emits status_changed but NOT completed for a non-completed transition', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'PENDING', projectId: 'p1' }),
      taskUpdate: async () => ({ id: 't1', status: 'IN_PROGRESS', projectId: 'p1' }),
    });
    await svc.updateStatus('ws1', user, 't1', 'IN_PROGRESS' as any);
    expect(emittedPayload(emit, 'task.status_changed')).toBeDefined();
    expect(emittedPayload(emit, 'task.completed')).toBeUndefined();
  });

  it('does NOT emit when the status is unchanged', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'IN_PROGRESS', projectId: 'p1' }),
      taskUpdate: async () => ({ id: 't1', status: 'IN_PROGRESS', projectId: 'p1' }),
    });
    await svc.updateStatus('ws1', user, 't1', 'IN_PROGRESS' as any);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('TasksService.markComplete — completed event', () => {
  it('emits status_changed + completed when not already completed', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'PENDING', projectId: 'p1' }),
      taskUpdate: async () => ({ id: 't1', status: 'COMPLETED', projectId: 'p1' }),
    });
    await svc.markComplete('ws1', user, 't1');
    expect(emittedPayload(emit, 'task.status_changed')?.toStatus).toBe('COMPLETED');
    expect(emittedPayload(emit, 'task.completed')).toBeDefined();
  });

  it('does NOT re-emit when the task was already COMPLETED', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'COMPLETED', projectId: 'p1' }),
      taskUpdate: async () => ({ id: 't1', status: 'COMPLETED', projectId: 'p1' }),
    });
    await svc.markComplete('ws1', user, 't1');
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('TasksService.assignTask — task.assigned event', () => {
  it('emits task.assigned when the assignee changes', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', assignedToId: null }),
      taskUpdate: async () => ({
        id: 't1',
        assignedToId: 'u9',
        project: {},
        assignedTo: { email: null },
        createdBy: null,
      }),
    });
    await svc.assignTask('ws1', user, 't1', 'u9');
    expect(emittedPayload(emit, 'task.assigned')).toEqual({
      workspaceId: 'ws1',
      taskId: 't1',
      assignedToId: 'u9',
      actorId: 'u1',
      task: expect.objectContaining({ id: 't1', assignedToId: 'u9' }),
    });
  });

  it('does NOT emit when re-assigning to the same user', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', assignedToId: 'u9' }),
      taskUpdate: async () => ({
        id: 't1',
        assignedToId: 'u9',
        project: {},
        assignedTo: { email: null },
        createdBy: null,
      }),
    });
    await svc.assignTask('ws1', user, 't1', 'u9');
    expect(emittedPayload(emit, 'task.assigned')).toBeUndefined();
  });
});

describe('TasksService.update — events + assignee change', () => {
  it('emits status_changed + completed and stamps completedAt on transition', async () => {
    const { svc, emit, tx } = makeService({
      taskFindUnique: async () => ({
        id: 't1',
        status: 'IN_PROGRESS',
        projectId: 'p1',
        createdById: 'u1',
        assignedToId: 'u1',
      }),
      taskUpdate: async (a: any) => ({ id: 't1', status: 'COMPLETED', projectId: 'p1', ...a.data }),
    });
    await svc.update('ws1', user, 't1', { status: 'COMPLETED' } as any, 'ADMIN' as any);
    expect(emittedPayload(emit, 'task.status_changed')?.fromStatus).toBe('IN_PROGRESS');
    expect(emittedPayload(emit, 'task.completed')).toBeDefined();
    // completedAt stamped when transitioning into COMPLETED.
    expect((tx.task.update as jest.Mock).mock.calls[0][0].data.completedAt).toBeInstanceOf(Date);
  });

  it('emits task.assigned when update changes the assignee', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({
        id: 't1',
        status: 'PENDING',
        projectId: 'p1',
        createdById: 'u1',
        assignedToId: null,
      }),
      taskUpdate: async (a: any) => ({ id: 't1', status: 'PENDING', projectId: 'p1', ...a.data }),
    });
    await svc.update('ws1', user, 't1', { assignedToId: 'u9' } as any, 'ADMIN' as any);
    expect(emittedPayload(emit, 'task.assigned')?.assignedToId).toBe('u9');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Wave 2: custom-field values merged into metadata.customFields
// ───────────────────────────────────────────────────────────────────────────

describe('TasksService — customFields validation + merge', () => {
  it('validates via CustomFieldsService and merges into metadata.customFields on create', async () => {
    const { svc, tx, customFields } = makeService({
      validateValues: async (_tx, _ws, _entity, incoming) => ({ ...incoming, normalized: true }),
    });
    await svc.create('ws1', user, {
      projectId: 'p1',
      title: 'x',
      metadata: { existing: 1 },
      customFields: { tier: 'gold' },
    } as any);

    expect(customFields!.validateValues).toHaveBeenCalledWith(tx, 'ws1', 'TASK', { tier: 'gold' });
    const data = (tx.task.create as jest.Mock).mock.calls[0][0].data;
    // Preserves other metadata keys, nests normalized values under customFields,
    // and does NOT leak the raw `customFields` DTO key into the Prisma data.
    expect(data.metadata).toEqual({
      existing: 1,
      customFields: { tier: 'gold', normalized: true },
    });
    expect(data.customFields).toBeUndefined();
  });

  it('throws BadRequest if customFields given but no CustomFieldsService is wired', async () => {
    const { svc } = makeService({}); // no validateValues → service undefined
    await expect(
      svc.create('ws1', user, {
        projectId: 'p1',
        title: 'x',
        customFields: { tier: 'gold' },
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('leaves metadata untouched when customFields is absent', async () => {
    const { svc, tx } = makeService({});
    await svc.create('ws1', user, {
      projectId: 'p1',
      title: 'x',
      metadata: { a: 1 },
    } as any);
    expect((tx.task.create as jest.Mock).mock.calls[0][0].data.metadata).toEqual({ a: 1 });
  });
});

describe('TasksService — CLIENT-role quote metadata masking', () => {
  const client = { id: 'c1', email: 'client@x.co', role: UserRole.CLIENT } as any;
  const staff = { id: 'u1', email: 'a@x.co', role: UserRole.ADMIN } as any;
  const TASK_META = {
    quote: {
      customer_ops_quote_id: 'q-1',
      customer_ops_line_id: 'line-9',
      number: 'Q-2026-0001',
      version: 1,
      line_kind: 'milestone',
      position: 2,
      weeks: 3,
      option_group: 'hosting',
    },
    customFields: { score: 1 },
  };

  it('findOne strips quote foreign ids from metadata for a CLIENT caller', async () => {
    const { svc } = makeService({
      taskFindUnique: async () => ({ id: 't1', metadata: TASK_META }),
    });
    const out: any = await svc.findOne('ws1', client, 't1');
    expect(out.metadata.quote).toEqual({
      number: 'Q-2026-0001',
      version: 1,
      line_kind: 'milestone',
      position: 2,
      weeks: 3,
    });
    expect(JSON.stringify(out)).not.toContain('customer_ops_quote_id');
    expect(JSON.stringify(out)).not.toContain('customer_ops_line_id');
  });

  it('findOne leaves metadata intact for a STAFF caller', async () => {
    const { svc } = makeService({
      taskFindUnique: async () => ({ id: 't1', metadata: TASK_META }),
    });
    const out: any = await svc.findOne('ws1', staff, 't1');
    expect(out.metadata).toEqual(TASK_META);
  });

  it('findAll masks every task in the page for a CLIENT caller', async () => {
    const { svc } = makeService({
      taskFindMany: async () => [
        { id: 't1', metadata: TASK_META },
        { id: 't2', metadata: TASK_META },
      ],
      taskCount: async () => 2,
    });
    const out: any = await svc.findAll('ws1', client, {});
    for (const t of out.data) {
      expect(t.metadata.quote.customer_ops_quote_id).toBeUndefined();
      expect(t.metadata.quote.customer_ops_line_id).toBeUndefined();
    }
  });

  it('getProjectTasks masks every task for a CLIENT caller', async () => {
    const { svc } = makeService({
      taskFindMany: async () => [{ id: 't1', metadata: TASK_META }],
    });
    const out: any = await svc.getProjectTasks('ws1', client, 'p1');
    expect(out[0].metadata.quote.customer_ops_quote_id).toBeUndefined();
    expect(out[0].metadata.quote.customer_ops_line_id).toBeUndefined();
  });

  it('getUserTasks masks every task for a CLIENT caller (my-tasks + user/:userId)', async () => {
    const { svc } = makeService({
      taskFindMany: async () => [{ id: 't1', metadata: TASK_META }],
    });
    const out: any = await svc.getUserTasks('ws1', client, 'c1');
    expect(out[0].metadata.quote.customer_ops_quote_id).toBeUndefined();
    expect(out[0].metadata.quote.customer_ops_line_id).toBeUndefined();
  });

  it('getUserTasks leaves metadata intact for a STAFF caller', async () => {
    const { svc } = makeService({
      taskFindMany: async () => [{ id: 't1', metadata: TASK_META }],
    });
    const out: any = await svc.getUserTasks('ws1', staff, 'c1');
    expect(out[0].metadata).toEqual(TASK_META);
  });

  it('getOverdueTasks masks every task for a CLIENT caller', async () => {
    const { svc } = makeService({
      taskFindMany: async () => [{ id: 't1', metadata: TASK_META }],
    });
    const out: any = await svc.getOverdueTasks('ws1', client);
    expect(out[0].metadata.quote.customer_ops_quote_id).toBeUndefined();
    expect(out[0].metadata.quote.customer_ops_line_id).toBeUndefined();
  });

  it('getSubtasks masks every subtask for a CLIENT caller', async () => {
    const { svc } = makeService({
      taskFindUnique: async () => ({ id: 'parent' }),
      taskFindMany: async () => [{ id: 't1', metadata: TASK_META }],
    });
    const out: any = await svc.getSubtasks('ws1', client, 'parent');
    expect(out[0].metadata.quote.customer_ops_quote_id).toBeUndefined();
    expect(out[0].metadata.quote.customer_ops_line_id).toBeUndefined();
  });
});

describe('TasksService.getUserTasks — ownership', () => {
  const client = { id: 'c1', role: UserRole.CLIENT } as any;
  const staff = { id: 'u1', role: UserRole.STAFF } as any;

  it("CLIENT cannot enumerate another user's tasks", async () => {
    const { svc } = makeService({ taskFindMany: async () => [] });
    await expect(svc.getUserTasks('ws1', client, 'c2')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('CLIENT can enumerate their own tasks', async () => {
    const { svc } = makeService({ taskFindMany: async () => [] });
    await expect(svc.getUserTasks('ws1', client, 'c1')).resolves.toEqual([]);
  });

  it("STAFF can enumerate another user's tasks", async () => {
    const { svc } = makeService({ taskFindMany: async () => [] });
    await expect(svc.getUserTasks('ws1', staff, 'c2')).resolves.toEqual([]);
  });
});

describe('TasksService write routes — safe selects + CLIENT masking', () => {
  const client = { id: 'c1', role: UserRole.CLIENT } as any;
  const TASK_META = {
    quote: { customer_ops_quote_id: 'q-1', customer_ops_line_id: 'line-9', number: 'Q-1' },
  };
  const SAFE_USER_SELECT = {
    select: { id: true, email: true, firstName: true, lastName: true, role: true },
  };
  const SAFE_PROJECT_SELECT = {
    select: { id: true, projectNumber: true, title: true, status: true, priority: true },
  };

  it('updateStatus returns safe selects (no full user/project row)', async () => {
    const { svc, tx } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'PENDING', projectId: 'p1' }),
      taskUpdate: async () => ({ id: 't1', status: 'IN_PROGRESS', projectId: 'p1' }),
    });
    await svc.updateStatus('ws1', user, 't1', 'IN_PROGRESS' as any);
    const args = (tx.task.update as jest.Mock).mock.calls[0][0];
    expect(args.include.project).toEqual(SAFE_PROJECT_SELECT);
    expect(args.include.assignedTo).toEqual(SAFE_USER_SELECT);
    expect(args.include.createdBy).toEqual(SAFE_USER_SELECT);
  });

  it('markComplete returns safe selects (no full user/project row)', async () => {
    const { svc, tx } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'PENDING', projectId: 'p1' }),
      taskUpdate: async () => ({ id: 't1', status: 'COMPLETED', projectId: 'p1' }),
    });
    await svc.markComplete('ws1', user, 't1');
    const args = (tx.task.update as jest.Mock).mock.calls[0][0];
    expect(args.include.project).toEqual(SAFE_PROJECT_SELECT);
    expect(args.include.assignedTo).toEqual(SAFE_USER_SELECT);
    expect(args.include.createdBy).toEqual(SAFE_USER_SELECT);
  });

  it('assignTask returns safe selects (no full user/project row)', async () => {
    const { svc, tx } = makeService({
      taskFindUnique: async () => ({ id: 't1', assignedToId: null }),
      taskUpdate: async () => ({ id: 't1', assignedToId: 'u9' }),
    });
    await svc.assignTask('ws1', user, 't1', 'u9');
    const args = (tx.task.update as jest.Mock).mock.calls[0][0];
    expect(args.include.project).toEqual(SAFE_PROJECT_SELECT);
    expect(args.include.assignedTo).toEqual(SAFE_USER_SELECT);
    expect(args.include.createdBy).toEqual(SAFE_USER_SELECT);
  });

  it('updateStatus masks metadata for a CLIENT caller', async () => {
    const { svc } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'PENDING', projectId: 'p1' }),
      taskUpdate: async () => ({
        id: 't1',
        status: 'IN_PROGRESS',
        projectId: 'p1',
        metadata: TASK_META,
      }),
    });
    const out: any = await svc.updateStatus('ws1', client, 't1', 'IN_PROGRESS' as any);
    expect(out.metadata.quote.customer_ops_quote_id).toBeUndefined();
    expect(out.metadata.quote.customer_ops_line_id).toBeUndefined();
  });

  it('update masks metadata for a CLIENT caller (creator)', async () => {
    const { svc } = makeService({
      taskFindUnique: async () => ({
        id: 't1',
        status: 'PENDING',
        projectId: 'p1',
        createdById: 'c1',
        assignedToId: null,
      }),
      taskUpdate: async (a: any) => ({
        id: 't1',
        status: 'PENDING',
        projectId: 'p1',
        metadata: TASK_META,
        ...a.data,
      }),
    });
    const out: any = await svc.update('ws1', client, 't1', { title: 'x' } as any, UserRole.CLIENT);
    expect(out.metadata.quote.customer_ops_quote_id).toBeUndefined();
    expect(out.metadata.quote.customer_ops_line_id).toBeUndefined();
  });
});

describe('TasksService write events — automation-rule fields resolve', () => {
  const staff = { id: 'u1', role: UserRole.STAFF } as any;

  const taskEventFixture = () => ({
    id: 't1',
    projectId: 'p1',
    status: 'IN_PROGRESS',
    project: { id: 'p1', projectNumber: 'PN-1', title: 'P', status: 'ACTIVE', priority: 'HIGH' },
    createdBy: { id: 'u1', email: 'a@x.co', firstName: 'A', lastName: 'S', role: 'STAFF' },
    assignedTo: { id: 'u2', email: 'b@x.co', firstName: 'B', lastName: 'T', role: 'STAFF' },
  });

  it('task.status_changed carries task.project.status/priority and task.createdBy/assignedTo.role', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', status: 'PENDING', projectId: 'p1' }),
      taskUpdate: async () => taskEventFixture(),
    });

    await svc.updateStatus('ws1', staff, 't1', 'IN_PROGRESS' as any);

    const evt = emit.mock.calls.find((c) => c[0] === 'task.status_changed')?.[1];
    expect(evt).toBeDefined();
    expect(resolveField(evt, 'task.project.status')).toBe('ACTIVE');
    expect(resolveField(evt, 'task.project.priority')).toBe('HIGH');
    expect(resolveField(evt, 'task.createdBy.role')).toBe('STAFF');
    expect(resolveField(evt, 'task.assignedTo.role')).toBe('STAFF');
  });

  it('task.assigned carries task.project.status and task.createdBy.role', async () => {
    const { svc, emit } = makeService({
      taskFindUnique: async () => ({ id: 't1', assignedToId: null }),
      taskUpdate: async () => ({ ...taskEventFixture(), assignedToId: 'u2' }),
    });

    await svc.assignTask('ws1', staff, 't1', 'u2');

    const evt = emit.mock.calls.find((c) => c[0] === 'task.assigned')?.[1];
    expect(evt).toBeDefined();
    expect(resolveField(evt, 'task.project.status')).toBe('ACTIVE');
    expect(resolveField(evt, 'task.createdBy.role')).toBe('STAFF');
  });
});
