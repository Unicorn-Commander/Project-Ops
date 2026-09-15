import { CommentsService } from './comments.service';

/**
 * Unit tests for CommentsService.findByProjectId pagination (audit fix).
 *
 * The method used to `findMany` with no `take`/`skip`, so a project with
 * thousands of comments loaded them all. It now applies the controller-clamped
 * `take`/`skip` and defends with sane fallbacks for any other caller. These
 * tests assert the bound reaches Prisma and that the transform shape is intact.
 */

function makeService(findManyImpl: (args: any) => Promise<any[]>) {
  const findMany = jest.fn(async (args: any) => findManyImpl(args));
  const tx = { comment: { findMany } };

  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };

  const svc = new CommentsService(
    {} as any, // prisma
    workspaceContext as any,
    { log: async () => null } as any, // audit
    { emit: () => true } as any, // events
    { createMentionNotifications: async () => [] } as any, // notifications
  );
  return { svc, findMany };
}

const user = { id: 'u1', email: 'a@x.co', keycloakId: 'kc1' } as any;

const rawComment = (id: string) => ({
  id,
  projectId: 'p1',
  authorId: 'u1',
  content: 'hello world',
  isInternal: false,
  createdAt: new Date('2026-06-17T00:00:00Z'),
  updatedAt: new Date('2026-06-17T00:00:00Z'),
  author: { id: 'u1', firstName: 'Aaron', lastName: 'S', email: 'a@x.co' },
});

describe('CommentsService.findByProjectId pagination', () => {
  it('passes the provided take/skip through to findMany', async () => {
    const { svc, findMany } = makeService(async () => [rawComment('c1')]);

    await svc.findByProjectId('ws1', user, 'p1', { take: 25, skip: 50 });

    const args = findMany.mock.calls[0][0];
    expect(args.take).toBe(25);
    expect(args.skip).toBe(50);
    expect(args.where).toEqual({ projectId: 'p1' });
  });

  it('defaults to a bounded page size (50) when no params are given', async () => {
    const { svc, findMany } = makeService(async () => []);

    await svc.findByProjectId('ws1', user, 'p1');

    const args = findMany.mock.calls[0][0];
    expect(args.take).toBe(50);
    expect(args.skip).toBe(0);
  });

  it('caps an oversized take at 100 and floors a negative skip to 0', async () => {
    const { svc, findMany } = makeService(async () => []);

    await svc.findByProjectId('ws1', user, 'p1', { take: 100000, skip: -5 });

    const args = findMany.mock.calls[0][0];
    expect(args.take).toBe(100);
    expect(args.skip).toBe(0);
  });

  it('still transforms rows into the frontend contract', async () => {
    const { svc } = makeService(async () => [rawComment('c1')]);

    const out = await svc.findByProjectId('ws1', user, 'p1');

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'c1',
      projectId: 'p1',
      userId: 'u1',
      content: 'hello world',
      user: { id: 'u1', name: 'Aaron S', email: 'a@x.co' },
    });
  });
});

/**
 * Safe-select regression tests for findOne/findOneInTx.
 *
 * findOneInTx used to `include: { author: true, project: true }`, which
 * returned full User + Project rows (password hash, keycloakId, full project
 * payload). It must select only the safe, non-sensitive fields.
 */
function makeFindOneService(findUniqueImpl: (args: any) => Promise<any>) {
  const findUnique = jest.fn(async (args: any) => findUniqueImpl(args));
  const tx = { comment: { findUnique } };

  const workspaceContext = {
    runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
  };

  const svc = new CommentsService(
    {} as any, // prisma
    workspaceContext as any,
    { log: async () => null } as any, // audit
    { emit: () => true } as any, // events
    { createMentionNotifications: async () => [] } as any, // notifications
  );
  return { svc, findUnique };
}

describe('CommentsService.findOne safe-select', () => {
  it('selects only safe user fields (no passwordHash/keycloakId)', async () => {
    const { svc, findUnique } = makeFindOneService(async () => ({
      ...rawComment('c1'),
      author: { id: 'u1', email: 'a@x.co', firstName: 'Aaron', lastName: 'S' },
      project: { id: 'p1', projectNumber: 'PN-1', title: 'T' },
    }));

    await svc.findOne('ws1', user, 'c1');

    const args = findUnique.mock.calls[0][0];
    expect(args.include.author).toEqual({
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    expect(args.include.author).not.toEqual(true);
    expect(args.include.project).toEqual({
      select: { id: true, projectNumber: true, title: true },
    });
    expect(args.include.project).not.toEqual(true);
  });

  it('returns the comment with the safe author/project selects', async () => {
    const { svc } = makeFindOneService(async () => ({
      ...rawComment('c1'),
      author: { id: 'u1', email: 'a@x.co', firstName: 'Aaron', lastName: 'S' },
      project: { id: 'p1', projectNumber: 'PN-1', title: 'T' },
    }));

    const out: any = await svc.findOne('ws1', user, 'c1');

    expect(out.author).toEqual({
      id: 'u1',
      email: 'a@x.co',
      firstName: 'Aaron',
      lastName: 'S',
    });
    expect(out.author.passwordHash).toBeUndefined();
    expect(out.author.keycloakId).toBeUndefined();
    expect(out.project).toEqual({ id: 'p1', projectNumber: 'PN-1', title: 'T' });
  });

  it('throws NotFoundException when the comment is missing', async () => {
    const { svc } = makeFindOneService(async () => null);

    await expect(svc.findOne('ws1', user, 'nope')).rejects.toThrow(
      'Comment with ID nope not found',
    );
  });
});
