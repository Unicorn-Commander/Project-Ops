import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TaskDependencyType } from '@prisma/client';
import { DependencyDirection } from './dto/create-task-dependency.dto';
import { TaskSortBy, TaskSortDir } from './dto/query-tasks.dto';

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
  taskCommentCreate?: (args: any) => Promise<any>;
  projectFindUnique?: (args: any) => Promise<any>;
  depFindMany?: (args: any) => Promise<any[]>;
  depFindUnique?: (args: any) => Promise<any>;
  depCreate?: (args: any) => Promise<any>;
  depDelete?: (args: any) => Promise<any>;
}) {
  const tx = {
    project: {
      findUnique: jest.fn(opts.projectFindUnique ?? (async () => ({ id: 'p1' }))),
    },
    user: {
      findUnique: jest.fn(async () => ({ id: 'u-assignee' })),
    },
    task: {
      findUnique: jest.fn(opts.taskFindUnique ?? (async () => ({ id: 't' }))),
      findMany: jest.fn(opts.taskFindMany ?? (async () => [])),
      count: jest.fn(opts.taskCount ?? (async () => 0)),
      create: jest.fn(opts.taskCreate ?? (async (a: any) => ({ id: 'new', ...a.data }))),
    },
    taskComment: {
      create: jest.fn(
        opts.taskCommentCreate ??
          (async () => ({ id: 'c1', content: 'hello', author: {} })),
      ),
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

  const svc = new TasksService(
    {} as any, // prisma
    workspaceContext as any,
    {} as any, // emailService
    { get: (_k: string, d: any) => d } as any, // configService
    { emit } as any, // eventEmitter
  );

  return { svc, tx, emit };
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
    expect(args.orderBy).toEqual([
      { priority: 'desc' },
      { dueDate: 'asc' },
      { createdAt: 'desc' },
    ]);
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
    await expect(
      svc.removeDependency('ws1', user, 'taskX', 'd1'),
    ).rejects.toBeInstanceOf(NotFoundException);
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
