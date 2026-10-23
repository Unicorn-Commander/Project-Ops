import { UserRole } from '@prisma/client';
import { NotificationEmailListener } from './notification-email.listener';
import {
  DEFAULT_PREFERENCES,
  PreferenceKey,
  applyPreferencePatch,
  mergePreferences,
} from './notification-preferences';

/**
 * Behavioral tests for the EMAIL listener: the gate (email only when the master
 * toggle + event key are ON, email is configured, and the recipient is NOT the
 * actor) and resilience (a send/lookup failure is swallowed — never throws out
 * of the listener).
 */

type Recipient = {
  email: string;
  name: string;
  preferences: any;
  keycloakId?: string | null;
  role?: UserRole;
};

function makeListener(opts: {
  recipients?: Record<string, Recipient | null>;
  configured?: boolean;
  emailOpsConfigured?: boolean;
  membershipRole?: string | null;
  membership?: jest.Mock;
  send?: jest.Mock;
  resolveImpl?: jest.Mock;
}) {
  const recipients = opts.recipients ?? {};
  const resolveEmailRecipient =
    opts.resolveImpl ??
    jest.fn(async (id: string) =>
      id in recipients
        ? recipients[id]
        : {
            email: `${id}@x.co`,
            name: id,
            preferences: mergePreferences(null),
            keycloakId: `kc-${id}`,
            role: UserRole.STAFF,
          },
    );

  const notifications = {
    resolveEmailRecipient,
    resolveMentionRecipients: jest.fn(async () => [] as string[]),
  } as any;

  const send = opts.send ?? jest.fn(async () => ({ success: true, message: 'ok' }));
  const getActiveMembershipRole =
    opts.membership ??
    jest.fn(async () => (opts.membershipRole !== undefined ? opts.membershipRole : 'MEMBER'));
  const membership = { getActiveMembershipRole } as any;
  const email = {
    isConfigured: jest.fn(async () => opts.configured ?? true),
    canSend: jest.fn(async () => opts.configured ?? true),
    isEmailOpsConfigured: jest.fn(() => opts.emailOpsConfigured ?? true),
    sendNotificationEmail: send,
  } as any;

  const config = { get: jest.fn((_k: string, d?: string) => d) } as any;

  const listener = new NotificationEmailListener(notifications, email, config, membership);
  return { listener, notifications, email, send, config, membership };
}

const taskAssigned = (over: Partial<any> = {}) => ({
  workspaceId: 'ws1',
  taskId: 't1',
  assignedToId: 'u-assignee',
  actorId: 'u-actor',
  task: { title: 'Wire the API', projectId: 'p1' },
  ...over,
});

describe('NotificationEmailListener — task.assigned gate', () => {
  it('sends when enabled, configured, and recipient != actor', async () => {
    const { listener, send } = makeListener({});
    await listener.onTaskAssigned(taskAssigned());

    expect(send).toHaveBeenCalledTimes(1);
    const [to, name, content] = send.mock.calls[0];
    expect(to).toBe('u-assignee@x.co');
    expect(name).toBe('u-assignee');
    expect(content.subject).toContain('Wire the API');
    expect(content.url).toContain('/dashboard/projects/p1?task=t1');
    expect(content.cta).toBe('View task');
  });

  it('passes the Email-Ops routing idempotency key when workspace + entity are known', async () => {
    const { listener, send } = makeListener({});
    await listener.onTaskAssigned(taskAssigned());

    const [, , , routing] = send.mock.calls[0];
    expect(routing).toEqual({
      workspaceId: 'ws1',
      externalRef: 'task.assigned:t1:u-assignee',
      mode: 'send',
    });
  });

  it.each([UserRole.STAFF, UserRole.MANAGER, UserRole.ADMIN])(
    'uses mode=send for a proven %s workspace member',
    async (role) => {
      const { listener, send } = makeListener({
        recipients: {
          'u-assignee': {
            email: 'staff@x.co',
            name: 'Staff User',
            preferences: mergePreferences(null),
            role,
            keycloakId: 'kc-staff',
          },
        },
        membershipRole: 'MEMBER',
      });

      await listener.onTaskAssigned(taskAssigned());

      expect(send.mock.calls[0][3].mode).toBe('send');
    },
  );

  it('uses mode=draft for a CLIENT recipient even with active membership', async () => {
    const { listener, send } = makeListener({
      recipients: {
        'u-assignee': {
          email: 'client@x.co',
          name: 'Client User',
          preferences: mergePreferences(null),
          role: UserRole.CLIENT,
          keycloakId: 'kc-client',
        },
      },
      membershipRole: 'MEMBER',
    });

    await listener.onTaskAssigned(taskAssigned());

    expect(send.mock.calls[0][3].mode).toBe('draft');
  });

  it('uses mode=draft when the recipient has no active workspace membership', async () => {
    const { listener, send } = makeListener({ membershipRole: null });

    await listener.onTaskAssigned(taskAssigned());

    expect(send.mock.calls[0][3].mode).toBe('draft');
  });

  it('does not perform role gating or add Email-Ops routing when the flag is off', async () => {
    const { listener, send, membership } = makeListener({ emailOpsConfigured: false });

    await listener.onTaskAssigned(taskAssigned());

    expect(membership.getActiveMembershipRole).not.toHaveBeenCalled();
    expect(send.mock.calls[0][3]).toBeUndefined();
  });

  it('omits routing when the workspace is unknown (falls back to SMTP)', async () => {
    const { listener, send } = makeListener({});
    await listener.onTaskAssigned(taskAssigned({ workspaceId: undefined }));
    expect(send.mock.calls[0][3]).toBeUndefined();
  });

  it('does NOT send when the recipient IS the actor (self-assignment)', async () => {
    const { listener, send } = makeListener({});
    await listener.onTaskAssigned(taskAssigned({ actorId: 'u-assignee' }));
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT send when the master email toggle is off', async () => {
    const off = applyPreferencePatch(mergePreferences(null), { email: false });
    const { listener, send } = makeListener({
      recipients: { 'u-assignee': { email: 'a@x.co', name: 'A', preferences: off } },
    });
    await listener.onTaskAssigned(taskAssigned());
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT send when this event type is disabled in prefs', async () => {
    const noAssign = applyPreferencePatch(mergePreferences(null), {
      events: { [PreferenceKey.TASK_ASSIGNED]: false },
    });
    const { listener, send } = makeListener({
      recipients: { 'u-assignee': { email: 'a@x.co', name: 'A', preferences: noAssign } },
    });
    await listener.onTaskAssigned(taskAssigned());
    expect(send).not.toHaveBeenCalled();
  });

  it('does NOT send (and never calls canSend) when prefs gate fails first', async () => {
    const off = applyPreferencePatch(mergePreferences(null), { email: false });
    const { listener, email, send } = makeListener({
      recipients: { 'u-assignee': { email: 'a@x.co', name: 'A', preferences: off } },
    });
    await listener.onTaskAssigned(taskAssigned());
    expect(send).not.toHaveBeenCalled();
    expect(email.canSend).not.toHaveBeenCalled();
  });

  it('does NOT send when email is not configured for the deployment', async () => {
    const { listener, send } = makeListener({ configured: false });
    await listener.onTaskAssigned(taskAssigned());
    expect(send).not.toHaveBeenCalled();
  });

  it('skips silently when the recipient user cannot be resolved (missing/inactive)', async () => {
    const { listener, send } = makeListener({ recipients: { 'u-assignee': null } });
    await listener.onTaskAssigned(taskAssigned());
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores a malformed payload (no assignee) without throwing', async () => {
    const { listener, send } = makeListener({});
    await expect(
      listener.onTaskAssigned(taskAssigned({ assignedToId: undefined })),
    ).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('NotificationEmailListener — resilience', () => {
  it('swallows an SMTP send failure (returns success:false) and does not throw', async () => {
    const send = jest.fn(async () => ({ success: false, message: 'SMTP down' }));
    const { listener } = makeListener({ send });
    await expect(listener.onTaskAssigned(taskAssigned())).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('swallows a thrown error from sendNotificationEmail and does not throw', async () => {
    const send = jest.fn(async () => {
      throw new Error('transport exploded');
    });
    const { listener } = makeListener({ send });
    await expect(listener.onTaskAssigned(taskAssigned())).resolves.toBeUndefined();
  });

  it('swallows a thrown error from recipient resolution and does not throw', async () => {
    const resolveImpl = jest.fn(async () => {
      throw new Error('db down');
    });
    const { listener, send } = makeListener({ resolveImpl });
    await expect(listener.onTaskAssigned(taskAssigned())).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('NotificationEmailListener — mentions + status', () => {
  it('emails each @mention recipient resolved for a comment (audience matches in-app)', async () => {
    const { listener, notifications, send } = makeListener({});
    notifications.resolveMentionRecipients = jest.fn(async () => ['u-bob', 'u-carol']);

    await listener.onTaskCommentCreated({
      workspaceId: 'ws1',
      taskId: 't9',
      commentId: 'c1',
      authorId: 'u-self',
      content: 'great work @bob @carol',
    });

    expect(notifications.resolveMentionRecipients).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      content: 'great work @bob @carol',
      authorId: 'u-self',
    });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][2].url).toContain('/dashboard/tasks/t9');
    // The idempotency ref is disambiguated by the comment id so a second comment
    // on the same task to the same user is a DIFFERENT key.
    expect(send.mock.calls[0][3]).toEqual({
      workspaceId: 'ws1',
      externalRef: 'task.comment.created:t9:u-bob:c1',
      mode: 'send',
    });
  });

  it('no @mentions => no email work', async () => {
    const { listener, notifications, send } = makeListener({});
    notifications.resolveMentionRecipients = jest.fn(async () => []);
    await listener.onTaskCommentCreated({
      workspaceId: 'ws1',
      taskId: 't9',
      commentId: 'c1',
      authorId: 'u-self',
      content: 'no mentions here',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('task.status_changed emails the assignee with a human-readable status', async () => {
    const { listener, send } = makeListener({});
    await listener.onTaskStatusChanged({
      workspaceId: 'ws1',
      taskId: 't1',
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      actorId: 'u-actor',
      task: {
        title: 'Ship it',
        assignedToId: 'u-assignee',
        projectId: 'p1',
        updatedAt: '2026-10-23T06:00:00.000Z',
      },
    });
    // Default prefs have task_status_changed OFF -> no email under defaults.
    expect(send).not.toHaveBeenCalled();
  });

  it('task.status_changed sends to the assignee once they opt in', async () => {
    const on = applyPreferencePatch(mergePreferences(null), {
      events: { [PreferenceKey.TASK_STATUS_CHANGED]: true },
    });
    const { listener, send } = makeListener({
      recipients: {
        'u-assignee': {
          email: 'a@x.co',
          name: 'A',
          preferences: on,
          role: UserRole.STAFF,
          keycloakId: 'kc-assignee',
        },
        'u-actor': {
          email: 'actor@x.co',
          name: 'Alex',
          preferences: mergePreferences(null),
          role: UserRole.STAFF,
          keycloakId: 'kc-actor',
        },
      },
    });
    await listener.onTaskStatusChanged({
      workspaceId: 'ws1',
      taskId: 't1',
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      actorId: 'u-actor',
      task: {
        title: 'Ship it',
        assignedToId: 'u-assignee',
        projectId: 'p1',
        updatedAt: '2026-10-23T06:00:00.000Z',
      },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][2].body).toContain('In Progress');
    expect(send.mock.calls[0][2].body).toContain('Completed');
    expect(send.mock.calls[0][2].body).toContain('Alex');
  });

  it('uses a persisted task updatedAt so repeated status flips get distinct keys', async () => {
    const on = applyPreferencePatch(mergePreferences(null), {
      events: { [PreferenceKey.TASK_STATUS_CHANGED]: true },
    });
    const { listener, send } = makeListener({
      recipients: {
        'u-assignee': {
          email: 'a@x.co',
          name: 'A',
          preferences: on,
          role: UserRole.STAFF,
          keycloakId: 'kc-assignee',
        },
      },
    });

    await listener.onTaskStatusChanged({
      workspaceId: 'ws1',
      taskId: 't1',
      fromStatus: 'IN_PROGRESS',
      toStatus: 'COMPLETED',
      actorId: 'u-actor',
      task: {
        title: 'Ship it',
        assignedToId: 'u-assignee',
        updatedAt: '2026-10-23T06:00:00.000Z',
      },
    });
    await listener.onTaskStatusChanged({
      workspaceId: 'ws1',
      taskId: 't1',
      fromStatus: 'COMPLETED',
      toStatus: 'IN_PROGRESS',
      actorId: 'u-actor',
      task: {
        title: 'Ship it',
        assignedToId: 'u-assignee',
        updatedAt: '2026-10-23T06:05:00.000Z',
      },
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call[3].externalRef)).toEqual([
      'task.status_changed:t1:u-assignee:2026-10-23T06:00:00.000Z',
      'task.status_changed:t1:u-assignee:2026-10-23T06:05:00.000Z',
    ]);
  });

  it('uses a persisted project updatedAt so repeated project status flips get distinct keys', async () => {
    const on = applyPreferencePatch(mergePreferences(null), {
      events: { [PreferenceKey.PROJECT_STATUS_CHANGED]: true },
    });
    const { listener, send } = makeListener({
      recipients: {
        'u-assignee': {
          email: 'a@x.co',
          name: 'A',
          preferences: on,
          role: UserRole.ADMIN,
          keycloakId: 'kc-assignee',
        },
      },
    });

    await listener.onProjectStatusChanged({
      workspaceId: 'ws1',
      projectId: 'p1',
      fromStatus: 'NEW',
      toStatus: 'IN_PROGRESS',
      actorId: 'u-actor',
      project: {
        title: 'Project',
        assignedToId: 'u-assignee',
        updatedAt: '2026-10-23T06:00:00.000Z',
      },
    });
    await listener.onProjectStatusChanged({
      workspaceId: 'ws1',
      projectId: 'p1',
      fromStatus: 'IN_PROGRESS',
      toStatus: 'NEW',
      actorId: 'u-actor',
      project: {
        title: 'Project',
        assignedToId: 'u-assignee',
        updatedAt: '2026-10-23T06:05:00.000Z',
      },
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map((call) => call[3].externalRef)).toEqual([
      'project.status_changed:p1:u-assignee:2026-10-23T06:00:00.000Z',
      'project.status_changed:p1:u-assignee:2026-10-23T06:05:00.000Z',
    ]);
  });
});

describe('preference defaults sanity (shared with the model)', () => {
  it('high-signal defaults ON, noisy OFF', () => {
    expect(DEFAULT_PREFERENCES.events[PreferenceKey.TASK_ASSIGNED]).toBe(true);
    expect(DEFAULT_PREFERENCES.events[PreferenceKey.MENTION]).toBe(true);
    expect(DEFAULT_PREFERENCES.events[PreferenceKey.APPROVAL_REQUESTED]).toBe(true);
    expect(DEFAULT_PREFERENCES.events[PreferenceKey.PROJECT_STATUS_CHANGED]).toBe(false);
  });
});
