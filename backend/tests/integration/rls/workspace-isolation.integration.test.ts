/**
 * SUITE-IDENTITY §9 — Row Level Security workspace-isolation invariants.
 *
 * These tests PROVE the tenancy fence holds when the runtime connects as the
 * NOBYPASSRLS role `project_ops_app` (the role the production DATABASE_URL flips
 * to). They mirror `PrismaService.withWorkspace` exactly: an interactive
 * `$transaction` that pins the per-request GUC via
 * `set_config('app.current_workspace', <id>, true)` (== `SET LOCAL`), which the
 * `workspace_isolation` policy reads through `current_workspace_id()`.
 *
 * Phase D of phase2-tenancy-blueprint.md (D1). Run as `project_ops_app`, NOT the
 * owner — an owner is BYPASSRLS and would make every assertion vacuously pass,
 * so beforeAll asserts the connected role is genuinely NOBYPASSRLS and fails
 * loudly otherwise (no false green).
 *
 * Prerequisites (provisioned by the Phase D runbook against a THROWAWAY DB):
 *   - schema present (prisma db push) + the four tenancy migrations applied
 *     (roles, GUC chokepoint, RLS enable/force/policies, workspace seed, MU
 *     canonical re-key);
 *   - the two dogfood workspaces seeded (Magic Unicorn + Brightwater Labs);
 *   - 2 projects + 1 task per workspace, owned by users that exist;
 *   - aaron=OWNER@MU, shafen=MANAGER@GFL, shafen's MU membership REVOKED.
 *
 * Connection: PROJECT_OPS_APP_DATABASE_URL must point at the throwaway DB as the
 * `project_ops_app` role. We deliberately do NOT reuse the app's DATABASE_URL
 * (that is the owner/admin URL); the whole point is to exercise the non-bypass
 * role. If PROJECT_OPS_APP_DATABASE_URL is unset the suite is skipped (so it is
 * safe in CI environments that have not provisioned the role).
 */
import { PrismaClient } from '@prisma/client';

const APP_URL = process.env.PROJECT_OPS_APP_DATABASE_URL;

// Known dogfood workspace ids (seed literals; MU re-keyed to the suite-canonical
// id by 20260610090000_mu_canonical_rekey — see 20260609120000_phase2_workspace_seed).
const MU = '019e50a3-d995-723f-ab66-0f765f92c0f4'; // Magic Unicorn (suite-canonical)
const GFL = '01924a3c-0000-7f1a-beef-67f1ab5c0001'; // Brightwater Labs

// Skip (don't fail) when the non-bypass role URL isn't provisioned — keeps the
// suite green in environments without the throwaway DB, while still running in
// the Phase D runbook / any CI that sets PROJECT_OPS_APP_DATABASE_URL.
const describeOrSkip = APP_URL ? describe : describe.skip;

describeOrSkip('SUITE-IDENTITY §9 — RLS workspace isolation (as project_ops_app)', () => {
  let prisma: PrismaClient;

  /** Mirror of PrismaService.withWorkspace: SET LOCAL the GUC, run fn on tx. */
  function withWorkspace<T>(
    workspaceId: string | null,
    fn: (tx: any) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      if (workspaceId !== null) {
        // is_local=true => SET LOCAL, transaction-scoped, parameterized.
        await tx.$executeRaw`SELECT set_config('app.current_workspace', ${workspaceId}, true)`;
      }
      // else: leave the GUC unset to prove the no-GUC fail-closed case.
      return fn(tx);
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: APP_URL } } });
    await prisma.$connect();

    // GUARD: refuse to run unless we are genuinely on a NOBYPASSRLS role.
    // An owner/superuser is BYPASSRLS and would make every assertion vacuous.
    const role = await prisma.$queryRaw<
      { current_user: string; rolbypassrls: boolean; rolsuper: boolean }[]
    >`SELECT current_user, r.rolbypassrls, r.rolsuper
        FROM pg_roles r WHERE r.rolname = current_user`;
    const me = role[0];
    if (!me) throw new Error('could not resolve current_user role attributes');
    if (me.rolbypassrls || me.rolsuper) {
      throw new Error(
        `RLS proof must run as a NOBYPASSRLS, non-superuser role; connected as ` +
          `'${me.current_user}' (rolbypassrls=${me.rolbypassrls}, rolsuper=${me.rolsuper}). ` +
          `Point PROJECT_OPS_APP_DATABASE_URL at the project_ops_app role.`,
      );
    }
    expect(me.rolbypassrls).toBe(false);
    expect(me.rolsuper).toBe(false);
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('Invariant 1 — NO GUC set => zero rows (fail-closed read)', async () => {
    const { projects, tasks } = await withWorkspace(null, async (tx) => ({
      projects: await tx.project.count(),
      tasks: await tx.task.count(),
    }));
    expect(projects).toBe(0);
    expect(tasks).toBe(0);
  });

  it('Invariant 1 (write) — NO GUC set => INSERT rejected by WITH CHECK (fail-closed write)', async () => {
    // Case (a): with no GUC, current_workspace_id() is NULL, so the WITH CHECK
    // predicate `"workspaceId" = current_workspace_id()` evaluates to NULL (never
    // TRUE) for ANY supplied workspaceId — the write is rejected. This proves the
    // fence fails closed on writes too, not only on reads. We even hand it a real
    // workspace id (MU) to show it is the missing GUC, not a bad id, that rejects.
    await expect(
      withWorkspace(null, (tx) =>
        tx.$executeRaw`
          INSERT INTO projects
            (id, "workspaceId", "projectNumber", title, status, priority, "clientName", "createdById", "createdAt", "updatedAt")
          VALUES
            (gen_random_uuid(), ${MU}, 'NOGUC-INS-1', 'no-guc insert', 'NEW', 'MEDIUM',
             'attacker', (SELECT id FROM users LIMIT 1), now(), now())`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('Invariant 2 — GUC = Magic Unicorn => sees ONLY the 2 MU projects', async () => {
    const rows = await withWorkspace<{ workspaceId: string | null; projectNumber: string }[]>(
      MU,
      (tx) => tx.project.findMany({ select: { workspaceId: true, projectNumber: true } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.workspaceId === MU)).toBe(true);
    expect(rows.some((r) => r.workspaceId === GFL)).toBe(false);
  });

  it('Invariant 3 — GUC = Brightwater Labs => sees ONLY the 2 GFL projects', async () => {
    const rows = await withWorkspace<{ workspaceId: string | null; projectNumber: string }[]>(
      GFL,
      (tx) => tx.project.findMany({ select: { workspaceId: true, projectNumber: true } }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.workspaceId === GFL)).toBe(true);
    expect(rows.some((r) => r.workspaceId === MU)).toBe(false);
  });

  it('Invariant 4a — cross-workspace INSERT blocked by WITH CHECK (GUC=GFL, row=MU)', async () => {
    await expect(
      withWorkspace(GFL, (tx) =>
        tx.$executeRaw`
          INSERT INTO projects
            (id, "workspaceId", "projectNumber", title, status, priority, "clientName", "createdById", "createdAt", "updatedAt")
          VALUES
            (gen_random_uuid(), ${MU}, 'XW-INS-1', 'cross-ws insert', 'NEW', 'MEDIUM',
             'attacker', (SELECT id FROM users LIMIT 1), now(), now())`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('Invariant 4b — cross-workspace UPDATE (re-home into MU) blocked (GUC=GFL)', async () => {
    // GUC=GFL: the only visible rows are GFL projects. Attempt to move one into MU.
    // The post-image violates WITH CHECK ("workspaceId" must equal the GUC), so it
    // is rejected. (A no-op match-zero update is impossible to confuse with success
    // because the row IS visible under GFL, so the rejection is the real signal.)
    await expect(
      withWorkspace(GFL, (tx) =>
        tx.$executeRaw`UPDATE projects SET "workspaceId" = ${MU} WHERE "workspaceId" = ${GFL}`,
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('Invariant 4c — control: same-workspace UPDATE under correct GUC succeeds', async () => {
    // Proves 4a/4b reject because of the WITH CHECK, not because all writes fail.
    const affected = await withWorkspace(GFL, (tx) =>
      tx.$executeRaw`UPDATE projects SET "updatedAt" = now() WHERE "workspaceId" = ${GFL}`,
    );
    expect(affected).toBe(2);
  });

  it('Invariant 5 — shafen has EXACTLY ONE active membership: MANAGER@GFL; MU is REVOKED', async () => {
    // memberships is a control table (not RLS-fenced); readable by project_ops_app.
    const all = await prisma.$queryRaw<
      { workspaceId: string; role: string; status: string; isDefault: boolean }[]
    >`SELECT m."workspaceId", m.role, m.status, m."isDefault"
        FROM memberships m
        JOIN users u ON u."keycloakId" = m."userKey"
       WHERE lower(u.email) = 'shafenkhan@users.noreply.github.com'
       ORDER BY m."workspaceId"`;

    const active = all.filter((m) => m.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].workspaceId).toBe(GFL);
    expect(active[0].role).toBe('MANAGER');

    const muRow = all.find((m) => m.workspaceId === MU);
    expect(muRow).toBeDefined();
    expect(muRow!.status).toBe('REVOKED');
    expect(muRow!.isDefault).toBe(false);
  });
});
