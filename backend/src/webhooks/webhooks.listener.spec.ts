import { WebhooksListener } from './webhooks.listener';

/** Let detached fan-out microtasks settle. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeListener(
  targets: any[] = [{ id: 'wh1', url: 'https://a.example.com', secret: 's1' }],
) {
  const webhooks = {
    findEnabledTargetsForEvent: jest.fn(async () => targets),
  };
  const delivery = {
    deliverToTargets: jest.fn(async () => []),
  };
  const listener = new WebhooksListener(webhooks as any, delivery as any);
  return { listener, webhooks, delivery };
}

describe('WebhooksListener', () => {
  it('resolves subscribers for the workspace and dispatches a correctly-shaped envelope', async () => {
    const { listener, webhooks, delivery } = makeListener();

    listener.onTaskCreated({ workspaceId: 'ws1', taskId: 't1', title: 'Hi' });
    await flush();

    expect(webhooks.findEnabledTargetsForEvent).toHaveBeenCalledWith('ws1', 'task.created');
    expect(delivery.deliverToTargets).toHaveBeenCalledTimes(1);

    const [ws, sentTargets, envelope] = (delivery.deliverToTargets.mock.calls as any[])[0];
    expect(ws).toBe('ws1');
    expect(sentTargets).toHaveLength(1);
    expect(envelope).toMatchObject({
      event: 'task.created',
      workspaceId: 'ws1',
      data: { workspaceId: 'ws1', taskId: 't1', title: 'Hi' },
    });
    expect(typeof envelope.timestamp).toBe('string');
  });

  it('does NOT deliver when no endpoint subscribes', async () => {
    const { listener, delivery } = makeListener([]);
    listener.onProjectCreated({ workspaceId: 'ws1', projectId: 'p1' });
    await flush();
    expect(delivery.deliverToTargets).not.toHaveBeenCalled();
  });

  it('ignores a payload with no workspaceId without throwing or querying', async () => {
    const { listener, webhooks, delivery } = makeListener();
    expect(() => listener.onTaskAssigned({ taskId: 't1' } as any)).not.toThrow();
    await flush();
    expect(webhooks.findEnabledTargetsForEvent).not.toHaveBeenCalled();
    expect(delivery.deliverToTargets).not.toHaveBeenCalled();
  });

  it('never lets a fan-out failure escape (resilience)', async () => {
    const { listener, webhooks } = makeListener();
    (webhooks.findEnabledTargetsForEvent as jest.Mock).mockRejectedValue(new Error('db down'));

    // Synchronous entry must not throw...
    expect(() => listener.onTaskCompleted({ workspaceId: 'ws1', taskId: 't1' })).not.toThrow();
    // ...and the detached rejection is swallowed (no unhandled rejection).
    await expect(flush()).resolves.toBeUndefined();
  });

  it('routes each domain event to its event name', async () => {
    const { listener, webhooks } = makeListener();

    listener.onTaskStatusChanged({ workspaceId: 'ws1' });
    listener.onTaskCommentCreated({ workspaceId: 'ws1' });
    listener.onProjectStatusChanged({ workspaceId: 'ws1' });
    await flush();

    const events = (webhooks.findEnabledTargetsForEvent as jest.Mock).mock.calls.map((c) => c[1]);
    expect(events).toEqual(
      expect.arrayContaining([
        'task.status_changed',
        'task.comment.created',
        'project.status_changed',
      ]),
    );
  });
});
