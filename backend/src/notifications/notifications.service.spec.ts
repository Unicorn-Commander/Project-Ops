import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { DEFAULT_PREFERENCES, PreferenceKey } from './notification-preferences';

/**
 * Unit tests for NotificationsService. Mirrors the CommentsService spec style:
 * construct the service with a faked WorkspaceContextService whose
 * runForUser/runInWorkspace just invoke the callback with a supplied fake `tx`,
 * so we assert the exact Prisma args (workspace + per-user scoping, mention
 * resolution) without a DB.
 */

type TxFns = {
  notification?: Partial<Record<string, jest.Mock>>;
  user?: Partial<Record<string, jest.Mock>>;
  membership?: Partial<Record<string, jest.Mock>>;
};

function makeService(tx: TxFns) {
  const fullTx = {
    notification: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findFirstOrThrow: jest.fn(),
      ...(tx.notification ?? {}),
    },
    user: { findMany: jest.fn(), ...(tx.user ?? {}) },
    membership: { findMany: jest.fn(), ...(tx.membership ?? {}) },
  };

  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(fullTx)),
    runInWorkspace: jest.fn(async (_ws: any, _uid: any, fn: (t: any) => any) => fn(fullTx)),
  };

  const svc = new NotificationsService(
    {} as any, // prisma (unused; all access via tx)
    workspaceContext as any,
    {} as any, // membership service (member keys read via tx in resolve)
  );
  return { svc, fullTx, workspaceContext };
}

const user = { id: 'u-self', email: 'self@x.co', keycloakId: 'kc-self' } as any;

describe('NotificationsService.findForUser', () => {
  it('scopes by the current user id, applies unreadOnly, and returns counts', async () => {
    const { svc, fullTx } = makeService({
      notification: {
        findMany: jest.fn(async () => [{ id: 'n1' }]),
        count: jest
          .fn()
          .mockResolvedValueOnce(1) // total (filtered)
          .mockResolvedValueOnce(1), // unreadCount
      },
    });

    const out = await svc.findForUser('ws1', user, {
      skip: 0,
      take: 20,
      unreadOnly: true,
    });

    const findArgs = fullTx.notification.findMany.mock.calls[0][0];
    expect(findArgs.where).toEqual({ userId: 'u-self', readAt: null });
    expect(findArgs.orderBy).toEqual({ createdAt: 'desc' });
    expect(out).toMatchObject({ total: 1, unreadCount: 1 });
    expect(out.notifications).toHaveLength(1);
  });

  it('omits the readAt filter when unreadOnly is false', async () => {
    const { svc, fullTx } = makeService({
      notification: {
        findMany: jest.fn(async () => []),
        count: jest.fn().mockResolvedValue(0),
      },
    });

    await svc.findForUser('ws1', user, { unreadOnly: false });

    expect(fullTx.notification.findMany.mock.calls[0][0].where).toEqual({
      userId: 'u-self',
    });
  });
});

describe('NotificationsService.unreadCount', () => {
  it('counts only the current user unread rows', async () => {
    const { svc, fullTx } = makeService({
      notification: { count: jest.fn(async () => 3) },
    });

    const n = await svc.unreadCount('ws1', user);

    expect(n).toBe(3);
    expect(fullTx.notification.count).toHaveBeenCalledWith({
      where: { userId: 'u-self', readAt: null },
    });
  });
});

describe('NotificationsService.markAllRead', () => {
  it('updates only the current user unread rows and returns the count', async () => {
    const { svc, fullTx } = makeService({
      notification: { updateMany: jest.fn(async () => ({ count: 4 })) },
    });

    const r = await svc.markAllRead('ws1', user);

    expect(r).toEqual({ updated: 4 });
    const args = fullTx.notification.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u-self', readAt: null });
    expect(args.data.readAt).toBeInstanceOf(Date);
  });
});

describe('NotificationsService.markRead', () => {
  it('marks an unread notification read', async () => {
    const row = { id: 'n1', userId: 'u-self', readAt: new Date() };
    const { svc, fullTx } = makeService({
      notification: {
        updateMany: jest.fn(async () => ({ count: 1 })),
        findFirstOrThrow: jest.fn(async () => row),
      },
    });

    const out = await svc.markRead('ws1', user, 'n1');

    expect(out).toBe(row);
    expect(fullTx.notification.updateMany.mock.calls[0][0].where).toEqual({
      id: 'n1',
      userId: 'u-self',
      readAt: null,
    });
  });

  it('is idempotent: already-read returns the row (200, not 404)', async () => {
    const existing = { id: 'n1', userId: 'u-self', readAt: new Date() };
    const { svc } = makeService({
      notification: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => existing),
      },
    });

    await expect(svc.markRead('ws1', user, 'n1')).resolves.toBe(existing);
  });

  it("404s when the id is not the current user's notification", async () => {
    const { svc } = makeService({
      notification: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findFirst: jest.fn(async () => null),
      },
    });

    await expect(svc.markRead('ws1', user, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('NotificationsService.resolveMentionedUserIds', () => {
  const tx = (users: any[], members: any[]) => ({
    user: { findMany: jest.fn(async () => users) },
    membership: { findMany: jest.fn(async () => members) },
  });

  it('resolves member handles, excludes the author, ignores unknown handles', async () => {
    const { svc } = makeService({});
    const t = tx(
      [
        { id: 'u-bob', keycloakId: 'kc-bob' },
        { id: 'u-self', keycloakId: 'kc-self' }, // the author, must be dropped
      ],
      [{ userKey: 'kc-bob' }, { userKey: 'kc-self' }],
    );

    const ids = await svc.resolveMentionedUserIds(
      t as any,
      'ws1',
      'hey @bob and @self and @ghost',
      'u-self',
    );

    expect(ids).toEqual(['u-bob']);
  });

  it('drops a matched user who is NOT a member of the workspace', async () => {
    const { svc } = makeService({});
    const t = tx(
      [{ id: 'u-carol', keycloakId: 'kc-carol' }],
      [{ userKey: 'kc-someone-else' }], // carol is not a member
    );

    const ids = await svc.resolveMentionedUserIds(t as any, 'ws1', '@carol', 'u-self');

    expect(ids).toEqual([]);
  });

  it('tenancy-off fallback: with no member rows, every matched user is eligible', async () => {
    const { svc } = makeService({});
    const t = tx([{ id: 'u-dave', keycloakId: null }], []); // zero memberships

    const ids = await svc.resolveMentionedUserIds(t as any, 'ws1', '@dave', 'u-self');

    expect(ids).toEqual(['u-dave']);
  });

  it('returns [] when there are no handles (no DB calls)', async () => {
    const { svc } = makeService({});
    const t = tx([], []);

    const ids = await svc.resolveMentionedUserIds(t as any, 'ws1', 'plain text', null);

    expect(ids).toEqual([]);
    expect(t.user.findMany as jest.Mock).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.createMentionNotifications', () => {
  it('writes one MENTION row per recipient with the right entity fields', async () => {
    const created: any[] = [];
    const { svc } = makeService({
      user: {
        findMany: jest.fn(async () => [{ id: 'u-bob', keycloakId: 'kc-bob' }]),
      },
      membership: { findMany: jest.fn(async () => [{ userKey: 'kc-bob' }]) },
      notification: {
        create: jest.fn(async ({ data }: any) => {
          created.push(data);
          return { id: `n-${created.length}`, ...data };
        }),
      },
    });

    const rows = await svc.createMentionNotifications({
      workspaceId: 'ws1',
      content: 'great work @bob',
      authorId: 'u-self',
      entityType: 'TASK',
      entityId: 'task-9',
      title: 'You were mentioned in a task comment',
    });

    expect(rows).toHaveLength(1);
    expect(created[0]).toMatchObject({
      workspaceId: 'ws1',
      userId: 'u-bob',
      type: 'MENTION',
      title: 'You were mentioned in a task comment',
      entityType: 'TASK',
      entityId: 'task-9',
      actorId: 'u-self',
    });
    expect(created[0].body).toContain('great work @bob');
  });

  it('no mentions -> no DB work, returns []', async () => {
    const { svc, workspaceContext } = makeService({});

    const rows = await svc.createMentionNotifications({
      workspaceId: 'ws1',
      content: 'nothing to see',
      authorId: 'u-self',
      entityType: 'PROJECT',
      entityId: 'p1',
    });

    expect(rows).toEqual([]);
    // Short-circuits BEFORE opening a workspace tx.
    expect(workspaceContext.runInWorkspace).not.toHaveBeenCalled();
  });
});

describe('NotificationsService email preferences', () => {
  // These read/write the GLOBAL User row directly via prisma (not workspace tx),
  // so we inject a prisma mock rather than route through workspaceContext.
  function makePrefService(userRow: any) {
    const prismaUser = {
      findUnique: jest.fn(async () => userRow),
      update: jest.fn(async ({ data }: any) => ({ ...userRow, ...data })),
    };
    const svc = new NotificationsService({ user: prismaUser } as any, {} as any, {} as any);
    return { svc, prismaUser };
  }

  it('getPreferences: null column => full defaults', async () => {
    const { svc } = makePrefService({ notificationPreferences: null });
    const p = await svc.getPreferences({ id: 'u1' } as any);
    expect(p).toEqual(DEFAULT_PREFERENCES);
  });

  it('getPreferences: merges a partial stored map over defaults', async () => {
    const { svc } = makePrefService({
      notificationPreferences: {
        email: false,
        events: { [PreferenceKey.PROJECT_STATUS_CHANGED]: true },
      },
    });
    const p = await svc.getPreferences({ id: 'u1' } as any);
    expect(p.email).toBe(false);
    expect(p.events[PreferenceKey.PROJECT_STATUS_CHANGED]).toBe(true);
    expect(p.events[PreferenceKey.TASK_ASSIGNED]).toBe(true); // default kept
  });

  it('updatePreferences: shallow-merges the patch and persists the full object scoped to the user', async () => {
    const { svc, prismaUser } = makePrefService({ notificationPreferences: null });
    const out = await svc.updatePreferences({ id: 'u1' } as any, {
      events: { [PreferenceKey.TASK_ASSIGNED]: false },
    });

    expect(out.events[PreferenceKey.TASK_ASSIGNED]).toBe(false); // changed
    expect(out.events[PreferenceKey.MENTION]).toBe(true); // untouched default
    const args = prismaUser.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: 'u1' });
    expect(args.data.notificationPreferences.events[PreferenceKey.TASK_ASSIGNED]).toBe(false);
  });

  it('resolveEmailRecipient: returns email/name/prefs for an active user', async () => {
    const { svc } = makePrefService({
      email: 'bob@x.co',
      firstName: 'Bob',
      lastName: 'Lee',
      isActive: true,
      notificationPreferences: null,
    });
    const r = await svc.resolveEmailRecipient('u-bob');
    expect(r).toMatchObject({ email: 'bob@x.co', name: 'Bob Lee' });
    expect(r!.preferences).toEqual(DEFAULT_PREFERENCES);
  });

  it('resolveEmailRecipient: null for an inactive user or one with no email', async () => {
    const inactive = makePrefService({
      email: 'x@x.co',
      firstName: 'X',
      lastName: 'Y',
      isActive: false,
      notificationPreferences: null,
    });
    expect(await inactive.svc.resolveEmailRecipient('u')).toBeNull();

    const noEmail = makePrefService({
      email: null,
      firstName: 'X',
      lastName: 'Y',
      isActive: true,
      notificationPreferences: null,
    });
    expect(await noEmail.svc.resolveEmailRecipient('u')).toBeNull();
  });
});
