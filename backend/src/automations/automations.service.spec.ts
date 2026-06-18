import { AutomationTrigger } from '@prisma/client';
import { AutomationsService } from './automations.service';
import { AutomationContext } from './automation-context';
import {
  TaskCreatedEvent,
  TaskStatusChangedEvent,
} from './automation.types';

/**
 * Unit tests for the rules engine: condition gating, action dispatch to the
 * injected services, the loop guard, and resilience (a failing action/rule
 * never escapes). Hand-rolled mocks in the suite style (see
 * tasks.service.spec.ts): `workspaceContext.run*` invoke their callback with a
 * fake tx so the real method bodies run without a DB. AutomationContext is the
 * REAL one (real AsyncLocalStorage) so the loop guard is genuinely exercised.
 */

const ACTOR = { id: 'creator-1', role: 'ADMIN', email: 'a@x.co' };

function makeService(opts: {
  rules?: any[]; // rules returned by automationRule.findMany
  maxDepth?: string;
  actor?: any | null; // user.findUnique result (rule creator)
  tasks?: Partial<Record<'assignTask' | 'updateStatus' | 'addComment' | 'create', jest.Mock>>;
  notificationsCreate?: jest.Mock;
} = {}) {
  const ruleUpdate = jest.fn(async () => ({}));
  const tx = {
    automationRule: {
      findMany: jest.fn(async () => opts.rules ?? []),
      update: ruleUpdate,
      findUnique: jest.fn(async () => (opts.rules ?? [])[0] ?? null),
      create: jest.fn(async (a: any) => ({ id: 'r-new', ...a.data })),
      delete: jest.fn(async () => ({})),
    },
    user: {
      findUnique: jest.fn(async () => (opts.actor === undefined ? ACTOR : opts.actor)),
    },
  };

  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
    runInWorkspace: jest.fn(async (_ws: any, _uid: any, fn: (t: any) => any) => fn(tx)),
  };

  const tasks = {
    assignTask: opts.tasks?.assignTask ?? jest.fn(async () => ({ id: 't1' })),
    updateStatus: opts.tasks?.updateStatus ?? jest.fn(async () => ({ id: 't1' })),
    addComment: opts.tasks?.addComment ?? jest.fn(async () => ({ id: 'c1' })),
    create: opts.tasks?.create ?? jest.fn(async () => ({ id: 't-new' })),
  };

  const notifications = {
    create: opts.notificationsCreate ?? jest.fn(async () => ({ id: 'n1' })),
  };

  const config = {
    get: (k: string) => (k === 'AUTOMATION_MAX_DEPTH' ? opts.maxDepth : undefined),
  };

  const automationContext = new AutomationContext();

  const svc = new AutomationsService(
    workspaceContext as any,
    config as any,
    tasks as any,
    notifications as any,
    automationContext,
  );

  return { svc, tasks, notifications, ruleUpdate, workspaceContext, automationContext, tx };
}

const taskCreated = (overrides: Partial<TaskCreatedEvent> = {}): TaskCreatedEvent => ({
  workspaceId: 'ws-1',
  taskId: 't1',
  projectId: 'p1',
  actorId: 'human-1',
  task: { id: 't1', priority: 'URGENT', projectId: 'p1' },
  ...overrides,
});

describe('runRulesForEvent — gating', () => {
  it('does nothing when no rules match the trigger', async () => {
    const { svc, tasks } = makeService({ rules: [] });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(fired).toBe(0);
    expect(tasks.assignTask).not.toHaveBeenCalled();
  });

  it('skips a rule whose conditions do not match', async () => {
    const { svc, tasks } = makeService({
      rules: [
        {
          id: 'r1',
          workspaceId: 'ws-1',
          createdById: 'creator-1',
          actions: [{ type: 'assign_task', params: { userId: 'u-lead' } }],
          conditions: [{ field: 'task.priority', op: 'eq', value: 'LOW' }],
        },
      ],
    });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(fired).toBe(0);
    expect(tasks.assignTask).not.toHaveBeenCalled();
  });

  it('fires a rule whose conditions match and bumps runCount', async () => {
    const { svc, tasks, ruleUpdate } = makeService({
      rules: [
        {
          id: 'r1',
          name: 'assign urgent',
          workspaceId: 'ws-1',
          createdById: 'creator-1',
          actions: [{ type: 'assign_task', params: { userId: 'u-lead' } }],
          conditions: [{ field: 'task.priority', op: 'eq', value: 'URGENT' }],
        },
      ],
    });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(fired).toBe(1);
    expect(tasks.assignTask).toHaveBeenCalledWith('ws-1', expect.objectContaining({ id: 'creator-1' }), 't1', 'u-lead');
    expect(ruleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ runCount: { increment: 1 } }),
      }),
    );
  });

  it('ignores an event with no workspaceId', async () => {
    const { svc } = makeService({ rules: [] });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, { taskId: 't' } as any);
    expect(fired).toBe(0);
  });
});

describe('runRulesForEvent — action dispatch', () => {
  function ruleWith(actions: any[], conditions: any[] = []) {
    return [
      { id: 'r1', name: 'rule', workspaceId: 'ws-1', createdById: 'creator-1', actions, conditions },
    ];
  }

  it('set_status calls TasksService.updateStatus on the event task', async () => {
    const { svc, tasks } = makeService({
      rules: ruleWith([{ type: 'set_status', params: { status: 'IN_PROGRESS' } }]),
    });
    await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(tasks.updateStatus).toHaveBeenCalledWith('ws-1', expect.any(Object), 't1', 'IN_PROGRESS');
  });

  it('add_comment maps params.text -> { content }', async () => {
    const { svc, tasks } = makeService({
      rules: ruleWith([{ type: 'add_comment', params: { text: 'auto note' } }]),
    });
    await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(tasks.addComment).toHaveBeenCalledWith('ws-1', expect.any(Object), 't1', {
      content: 'auto note',
    });
  });

  it('create_task uses params.projectId, else falls back to the event project', async () => {
    const { svc, tasks } = makeService({
      rules: ruleWith([{ type: 'create_task', params: { title: 'Follow up' } }]),
    });
    await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(tasks.create).toHaveBeenCalledWith(
      'ws-1',
      expect.any(Object),
      expect.objectContaining({ projectId: 'p1', title: 'Follow up' }),
    );
  });

  it('notify calls NotificationsService.create (no acting user needed)', async () => {
    const { svc, notifications } = makeService({
      rules: ruleWith([{ type: 'notify', params: { userId: 'u-watch', message: 'heads up' } }]),
      actor: null, // even with no resolvable actor, notify still fires
    });
    await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', userId: 'u-watch', title: 'heads up' }),
    );
  });

  it('skips task-mutating actions when the actor cannot be resolved, but still bumps runCount', async () => {
    const { svc, tasks, ruleUpdate } = makeService({
      rules: ruleWith([{ type: 'set_status', params: { status: 'COMPLETED' } }]),
      actor: null,
    });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(tasks.updateStatus).not.toHaveBeenCalled();
    expect(fired).toBe(1); // the rule ran (its actions were attempted)
    expect(ruleUpdate).toHaveBeenCalled();
  });

  it('a throwing action does not abort the rest of the rule or escape', async () => {
    const boom = jest.fn(async () => {
      throw new Error('assign failed');
    });
    const ok = jest.fn(async () => ({ id: 't1' }));
    const { svc } = makeService({
      rules: ruleWith([
        { type: 'assign_task', params: { userId: 'u1' } },
        { type: 'set_status', params: { status: 'IN_PROGRESS' } },
      ]),
      tasks: { assignTask: boom, updateStatus: ok },
    });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(boom).toHaveBeenCalled();
    expect(ok).toHaveBeenCalled(); // second action still ran
    expect(fired).toBe(1);
  });

  it('a rule that throws while loading is logged and the engine returns (no throw)', async () => {
    const { svc, workspaceContext } = makeService({ rules: [] });
    workspaceContext.runInWorkspace.mockRejectedValueOnce(new Error('db down'));
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_CREATED, taskCreated());
    expect(fired).toBe(0); // swallowed
  });
});

describe('runRulesForEvent — TASK_COMPLETED + status events', () => {
  it('matches a TASK_STATUS_CHANGED rule on toStatus', async () => {
    const { svc, tasks } = makeService({
      rules: [
        {
          id: 'r1',
          name: 'on done',
          workspaceId: 'ws-1',
          createdById: 'creator-1',
          actions: [{ type: 'notify', params: { userId: 'u-pm' } }],
          conditions: [{ field: 'toStatus', op: 'eq', value: 'COMPLETED' }],
        },
      ],
      notificationsCreate: jest.fn(async () => ({ id: 'n1' })),
    });
    const ev: TaskStatusChangedEvent = {
      workspaceId: 'ws-1',
      taskId: 't1',
      projectId: 'p1',
      toStatus: 'COMPLETED',
      fromStatus: 'IN_PROGRESS',
      actorId: 'human-1',
    };
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_STATUS_CHANGED, ev);
    expect(fired).toBe(1);
    void tasks;
  });
});

describe('LOOP GUARD', () => {
  function selfTriggeringRule() {
    // A rule whose action mutates the task -> emits an event -> would re-trigger.
    return [
      {
        id: 'r-loop',
        name: 'loopy',
        workspaceId: 'ws-1',
        createdById: 'creator-1',
        actions: [{ type: 'set_status', params: { status: 'IN_PROGRESS' } }],
        conditions: [],
      },
    ];
  }

  it('skips entirely when already inside an automation chain at/over maxDepth (default 1)', async () => {
    const { svc, tasks, automationContext } = makeService({ rules: selfTriggeringRule() });
    // Simulate being mid-action (depth 1 == maxDepth): a re-entrant event must be ignored.
    const fired = await automationContext.runInChain(1, () =>
      svc.runRulesForEvent(AutomationTrigger.TASK_STATUS_CHANGED, {
        workspaceId: 'ws-1',
        taskId: 't1',
        toStatus: 'IN_PROGRESS',
      } as any),
    );
    expect(fired).toBe(0);
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('honors the payload depth marker even outside an ALS chain', async () => {
    const { svc, tasks } = makeService({ rules: selfTriggeringRule() });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_STATUS_CHANGED, {
      workspaceId: 'ws-1',
      taskId: 't1',
      toStatus: 'IN_PROGRESS',
      __automation: { depth: 1 },
    } as any);
    expect(fired).toBe(0);
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });

  it('a re-entrant emit DURING an action does not cause infinite recursion', async () => {
    // updateStatus simulates TasksService emitting task.status_changed, which we
    // feed straight back into the engine. With maxDepth=1 the re-entrant call
    // must short-circuit (depth already 1 inside the action), so updateStatus is
    // invoked exactly once.
    let reentered = 0;
    const updateStatus = jest.fn(async () => {
      reentered++;
      if (reentered > 5) throw new Error('runaway recursion!');
      // Re-emit synchronously within the same ALS chain (depth is 1 here).
      await svc.runRulesForEvent(AutomationTrigger.TASK_STATUS_CHANGED, {
        workspaceId: 'ws-1',
        taskId: 't1',
        toStatus: 'IN_PROGRESS',
      } as any);
      return { id: 't1' };
    });

    const made = makeService({
      rules: selfTriggeringRule(),
      tasks: { updateStatus },
    });
    const svc = made.svc;

    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_STATUS_CHANGED, {
      workspaceId: 'ws-1',
      taskId: 't1',
      toStatus: 'IN_PROGRESS',
    } as any);

    expect(fired).toBe(1);
    expect(updateStatus).toHaveBeenCalledTimes(1); // re-entrant call was guarded
  });

  it('with maxDepth=0 the engine never runs any rule (fully disabled)', async () => {
    const { svc, tasks } = makeService({ rules: selfTriggeringRule(), maxDepth: '0' });
    const fired = await svc.runRulesForEvent(AutomationTrigger.TASK_STATUS_CHANGED, {
      workspaceId: 'ws-1',
      taskId: 't1',
      toStatus: 'IN_PROGRESS',
    } as any);
    expect(fired).toBe(0);
    expect(tasks.updateStatus).not.toHaveBeenCalled();
  });
});
