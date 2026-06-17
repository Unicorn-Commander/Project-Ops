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
