import { GoneException } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { ContactsService } from './contacts.service';
import {
  CLIENT_INVITE_EXPIRED_MESSAGE,
  CLIENT_INVITE_TTL_DAYS_DEFAULT,
  assertClientInviteCurrent,
  buildClientInviteUrl,
  clientInviteExpiresAt,
  clientInviteTtlDays,
  isClientInviteExpired,
} from './client-invite';

jest.mock('bcrypt', () => ({
  hash: jest.fn(async () => 'hashed-password'),
  compare: jest.fn(async () => true),
}));

const DAY = 24 * 60 * 60 * 1000;

function goneMessage(err: unknown): string {
  const body = (err as GoneException).getResponse();
  return typeof body === 'string' ? body : (body as { message: string }).message;
}

describe('client invite url and lifetime', () => {
  const originalTtl = process.env.CLIENT_INVITE_TTL_DAYS;
  const originalFrontend = process.env.FRONTEND_URL;

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.CLIENT_INVITE_TTL_DAYS;
    else process.env.CLIENT_INVITE_TTL_DAYS = originalTtl;
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
  });

  it('builds /auth/client-signup/<token>', () => {
    const url = buildClientInviteUrl('https://portal.example', 'abc123');
    expect(url).toBe('https://portal.example/auth/client-signup/abc123');
    expect(url).not.toContain('/auth/contact-signup/');
  });

  it('defaults the lifetime to 14 days and ignores unusable env values', () => {
    delete process.env.CLIENT_INVITE_TTL_DAYS;
    expect(clientInviteTtlDays()).toBe(CLIENT_INVITE_TTL_DAYS_DEFAULT);
    expect(clientInviteTtlDays('')).toBe(14);
    expect(clientInviteTtlDays('nope')).toBe(14);
    expect(clientInviteTtlDays('0')).toBe(14);
    expect(clientInviteTtlDays('-3')).toBe(14);
    expect(clientInviteTtlDays('7')).toBe(7);
    expect(clientInviteTtlDays(' 21 ')).toBe(21);
    expect(clientInviteTtlDays('14.9')).toBe(14);
    process.env.CLIENT_INVITE_TTL_DAYS = '3';
    expect(clientInviteTtlDays()).toBe(3);
  });

  it('expires on the 14-day boundary and treats a missing issue time as expired', () => {
    const sent = new Date('2026-01-01T00:00:00.000Z');
    expect(clientInviteExpiresAt(sent, 14).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(isClientInviteExpired(sent, new Date(sent.getTime() + 14 * DAY - 1), 14)).toBe(false);
    expect(isClientInviteExpired(sent, new Date(sent.getTime() + 14 * DAY), 14)).toBe(true);
    expect(isClientInviteExpired(null)).toBe(true);
    expect(isClientInviteExpired(undefined)).toBe(true);

    expect(() =>
      assertClientInviteCurrent(sent, new Date(sent.getTime() + 14 * DAY - 1), 14),
    ).not.toThrow();

    let caught: unknown;
    try {
      assertClientInviteCurrent(sent, new Date(sent.getTime() + 14 * DAY), 14);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GoneException);
    expect((caught as GoneException).getStatus()).toBe(410);
    expect(goneMessage(caught)).toBe(CLIENT_INVITE_EXPIRED_MESSAGE);
  });
});

describe('ContactsService.inviteToPortal', () => {
  const originalFrontend = process.env.FRONTEND_URL;

  afterEach(() => {
    if (originalFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontend;
  });

  it('emails the client-signup URL and replaces the previous token', async () => {
    process.env.FRONTEND_URL = 'https://portal.example';
    const started = Date.now();
    const update = jest.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    const deleteMany = jest.fn(async () => ({ count: 1 }));
    const upsert = jest.fn(async () => ({}));
    const tx = {
      contact: {
        findUnique: jest.fn(async () => ({
          id: 'contact-1',
          firstName: 'Ada',
          lastName: 'Example',
          email: 'ada.example@example.com',
          userId: null,
          invitationToken: 'old-token',
          invitationSentAt: new Date('2020-01-01T00:00:00.000Z'),
        })),
        update,
      },
      membership: { deleteMany, upsert },
    };
    const workspaceContext = {
      runForUser: jest.fn(async (_user: unknown, fn: (client: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
    const emailService = { isConfigured: jest.fn(async () => false) };
    const svc = new ContactsService(
      {} as never,
      workspaceContext as never,
      emailService as never,
      {} as never,
    );

    const result = await svc.inviteToPortal('ws-1', { id: 'staff-1' } as never, 'contact-1');

    const written = update.mock.calls[0][0].data as {
      invitationToken: string;
      invitationSentAt: Date;
    };
    expect(written.invitationToken).toMatch(/^[0-9a-f]{32}$/);
    expect(written.invitationToken).not.toBe('old-token');
    expect(written.invitationSentAt.getTime()).toBeGreaterThanOrEqual(started);
    expect(result.invitationToken).toBe(written.invitationToken);
    expect(result.invitationUrl).toBe(
      `https://portal.example/auth/client-signup/${written.invitationToken}`,
    );
    expect(result.invitationUrl).not.toContain('contact-signup');
    expect(result.emailSent).toBe(false);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { userKey: 'invite:old-token', workspaceId: 'ws-1' },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userKey_workspaceId: {
            userKey: `invite:${written.invitationToken}`,
            workspaceId: 'ws-1',
          },
        },
      }),
    );
  });
});

describe('AuthService.clientSignup invite lifetime', () => {
  const originalTtl = process.env.CLIENT_INVITE_TTL_DAYS;

  afterEach(() => {
    if (originalTtl === undefined) delete process.env.CLIENT_INVITE_TTL_DAYS;
    else process.env.CLIENT_INVITE_TTL_DAYS = originalTtl;
  });

  function makeAuth(tx: {
    contact: { findUnique: jest.Mock; update?: jest.Mock };
    user: { create: jest.Mock };
    membership?: { upsert: jest.Mock; deleteMany: jest.Mock };
  }) {
    const prisma = {
      membership: { findFirst: jest.fn(async () => ({ workspaceId: 'ws-1' })) },
      withWorkspace: jest.fn(
        async (_ws: string, _user: unknown, fn: (client: typeof tx) => unknown) => fn(tx),
      ),
    };
    const jwt = { sign: jest.fn(() => 'signed-session') };
    const membershipService = { listActiveWorkspaces: jest.fn(async () => []) };
    const auth = new AuthService(
      {} as never,
      jwt as never,
      {} as never,
      prisma as never,
      {} as never,
      membershipService as never,
    );
    return { auth, jwt };
  }

  function contact(invitationSentAt: Date | null) {
    return {
      id: 'contact-1',
      email: 'pat.example@example.com',
      firstName: 'Pat',
      lastName: 'Example',
      userId: null,
      invitationSentAt,
    };
  }

  const dto = { password: 'correct-horse', confirmPassword: 'correct-horse' };

  it('returns 410 and does not create a user once the invite is past 14 days', async () => {
    delete process.env.CLIENT_INVITE_TTL_DAYS;
    const userCreate = jest.fn();
    const { auth } = makeAuth({
      contact: { findUnique: jest.fn(async () => contact(new Date(Date.now() - 15 * DAY))) },
      user: { create: userCreate },
    });

    let caught: unknown;
    try {
      await auth.clientSignup('tok-expired', dto as never);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GoneException);
    expect((caught as GoneException).getStatus()).toBe(410);
    expect(goneMessage(caught)).toBe(CLIENT_INVITE_EXPIRED_MESSAGE);
    expect(userCreate).not.toHaveBeenCalled();
  });

  it('honors CLIENT_INVITE_TTL_DAYS and rejects an undated token', async () => {
    process.env.CLIENT_INVITE_TTL_DAYS = '2';
    const shortCreate = jest.fn();
    const { auth: shortAuth } = makeAuth({
      contact: { findUnique: jest.fn(async () => contact(new Date(Date.now() - 3 * DAY))) },
      user: { create: shortCreate },
    });
    await expect(shortAuth.clientSignup('tok-short', dto as never)).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(shortCreate).not.toHaveBeenCalled();

    const undatedCreate = jest.fn();
    const { auth: undatedAuth } = makeAuth({
      contact: { findUnique: jest.fn(async () => contact(null)) },
      user: { create: undatedCreate },
    });
    await expect(undatedAuth.clientSignup('tok-undated', dto as never)).rejects.toBeInstanceOf(
      GoneException,
    );
    expect(undatedCreate).not.toHaveBeenCalled();
  });

  it('creates the account when the invite is still inside the window', async () => {
    delete process.env.CLIENT_INVITE_TTL_DAYS;
    const created = {
      id: 'user-1',
      email: 'pat.example@example.com',
      username: 'pat.example@example.com',
      firstName: 'Pat',
      lastName: 'Example',
      role: 'CLIENT',
    };
    const userCreate = jest.fn(async () => created);
    const { auth } = makeAuth({
      contact: {
        findUnique: jest.fn(async () => contact(new Date())),
        update: jest.fn(async () => ({})),
      },
      user: { create: userCreate },
      membership: {
        upsert: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 1 })),
      },
    });

    const result = await auth.clientSignup('tok-fresh', dto as never);
    expect(userCreate).toHaveBeenCalled();
    expect(result.access_token).toBe('signed-session');
  });
});
