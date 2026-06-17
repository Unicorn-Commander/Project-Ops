import { OrganizationsService } from './organizations.service';

/**
 * Unit tests for the org hierarchy traversal after the N+1 fix.
 *
 * The four hierarchy helpers (getChildrenRecursive / getDescendantIds /
 * getAncestorIds / getOrganizationTreeIds) used to issue one query per tree
 * level. They now each resolve the tree in a SINGLE `WITH RECURSIVE` query run
 * through the workspace `tx` (so it shares the RLS GUC). These tests assert:
 *   1. the public return SHAPES are preserved (nested tree + `_count`, id lists);
 *   2. the work is done in a bounded number of raw queries (no per-level N+1);
 *   3. the raw query executes on the SAME `tx` the ORM uses (tenancy stays in
 *      the workspace transaction).
 *
 * `$queryRaw` is mocked to return flat CTE-shaped rows; the assembly logic
 * (buildTree) and the helper composition are what's under test.
 */

type RawRow = Record<string, any>;

function makeService(queryRawImpl: (sql: any) => Promise<any[]>) {
  // The single fake tx stands in for the workspace transaction client. Capturing
  // it lets us assert the raw query ran on THIS object (i.e. inside the RLS tx),
  // never on a bare prisma client.
  const tx = {
    $queryRaw: jest.fn(async (sql: any) => queryRawImpl(sql)),
    organization: {
      findUnique: jest.fn(),
    },
  };

  const workspaceContext = {
    // Mirrors the real runForUser contract: resolve + run fn against the tx.
    runForUser: jest.fn(async (_user: any, fn: (t: any) => any) => fn(tx)),
  };

  const prisma = {} as any;
  const svc = new OrganizationsService(prisma as any, workspaceContext as any);
  return { svc, tx, workspaceContext };
}

const orgRow = (over: Partial<RawRow>): RawRow => ({
  id: 'x',
  workspaceId: 'ws1',
  name: 'Org',
  type: 'AGENCY',
  parentOrgId: null,
  isActive: true,
  childOrgsCount: 0,
  contactsCount: 0,
  projectsCount: 0,
  depth: 1,
  ...over,
});

const user = { id: 'u1', email: 'a@x.co', keycloakId: 'kc1' } as any;

describe('OrganizationsService — hierarchy (N+1 fix)', () => {
  describe('getHierarchy', () => {
    it('builds the nested children tree from a single recursive query', async () => {
      // Root (id=root) is loaded via findUnique; the subtree CTE returns its
      // descendants flat: root has child A; A has grandchild B.
      const rows: RawRow[] = [
        orgRow({ id: 'A', parentOrgId: 'root', name: 'A', depth: 1, childOrgsCount: 1, contactsCount: 2 }),
        orgRow({ id: 'B', parentOrgId: 'A', name: 'B', depth: 2, projectsCount: 5 }),
      ];

      const { svc, tx } = makeService(async () => rows);
      tx.organization.findUnique.mockResolvedValue({ id: 'root', name: 'Root', childOrgs: [] });

      const result = await svc.getHierarchy('ws1', user, 'root');

      // top-level org detail preserved + hierarchy attached
      expect(result.id).toBe('root');
      expect(Array.isArray(result.hierarchy)).toBe(true);
      expect(result.hierarchy).toHaveLength(1);

      const a = result.hierarchy[0];
      expect(a.id).toBe('A');
      // _count folded from the *Count aliases; helper columns stripped
      expect(a._count).toEqual({ childOrgs: 1, contacts: 2, projects: 0 });
      expect(a).not.toHaveProperty('depth');
      expect(a).not.toHaveProperty('childOrgsCount');

      // nested grandchild
      expect(a.children).toHaveLength(1);
      expect(a.children[0].id).toBe('B');
      expect(a.children[0]._count).toEqual({ childOrgs: 0, contacts: 0, projects: 5 });
      expect(a.children[0].children).toEqual([]);

      // N+1 GUARD: the whole subtree came from ONE raw query (was one per level).
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('returns an empty hierarchy when the org has no children', async () => {
      const { svc, tx } = makeService(async () => []);
      tx.organization.findUnique.mockResolvedValue({ id: 'root', name: 'Root', childOrgs: [] });

      const result = await svc.getHierarchy('ws1', user, 'root');
      expect(result.hierarchy).toEqual([]);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('runs the recursive query on the workspace tx (RLS-scoped), not a bare client', async () => {
      const { svc, tx, workspaceContext } = makeService(async () => []);
      tx.organization.findUnique.mockResolvedValue({ id: 'root', childOrgs: [] });

      await svc.getHierarchy('ws1', user, 'root');

      // The body ran via runForUser (the GUC chokepoint) and the raw query was
      // issued on the tx handed to that callback.
      expect(workspaceContext.runForUser).toHaveBeenCalled();
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProjects(includeChildren) — getDescendantIds', () => {
    it('queries projects for the descendant set via one descendant query', async () => {
      // Descendant CTE returns ids B, C (root excluded — see note below).
      const descendantRows = [{ id: 'B' }, { id: 'C' }];
      const projectRows = [{ id: 'p1' }];

      const tx = {
        $queryRaw: jest.fn(async () => descendantRows),
        project: { findMany: jest.fn(async () => projectRows) },
        organization: { findUnique: jest.fn() },
      };
      const workspaceContext = {
        runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
      };
      const svc = new OrganizationsService({} as any, workspaceContext as any);

      const result = await svc.getProjects('ws1', user, 'root', true);

      expect(result).toBe(projectRows);
      // exactly one descendant query (no per-level N+1)
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      // FIXED (Push B): includeChildren now returns the org's OWN projects PLUS
      // its descendants' — `id` is unioned with the (root-excluding) descendant
      // set, so the parent org's own projects are no longer dropped.
      const findManyCalls = tx.project.findMany.mock.calls as any[];
      expect(findManyCalls[0][0].where.organizationId.in).toEqual(['root', 'B', 'C']);
    });

    it('does not run the descendant query when includeChildren is false', async () => {
      const tx = {
        $queryRaw: jest.fn(),
        project: { findMany: jest.fn(async () => []) },
        organization: { findUnique: jest.fn() },
      };
      const workspaceContext = {
        runForUser: jest.fn(async (_u: any, fn: (t: any) => any) => fn(tx)),
      };
      const svc = new OrganizationsService({} as any, workspaceContext as any);

      await svc.getProjects('ws1', user, 'root', false);

      expect(tx.$queryRaw).not.toHaveBeenCalled();
      const findManyCalls = tx.project.findMany.mock.calls as any[];
      expect(findManyCalls[0][0].where.organizationId.in).toEqual(['root']);
    });
  });
});
