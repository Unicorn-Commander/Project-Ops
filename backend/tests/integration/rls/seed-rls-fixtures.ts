/**
 * SUITE-IDENTITY §9 — RLS workspace-isolation TEST FIXTURES seed.
 *
 * Companion to `workspace-isolation.integration.test.ts`. That test runs as the
 * NOBYPASSRLS role `project_ops_app` and asserts hard invariants:
 *   - GUC=Magic Unicorn  => EXACTLY 2 projects, all workspaceId=MU
 *   - GUC=Brightwater Labs => EXACTLY 2 projects, all workspaceId=GFL
 *   - same-workspace UPDATE under GUC=GFL affects EXACTLY 2 rows
 *   - cross-workspace INSERT/UPDATE rejected by the WITH CHECK policy
 *   - the no-GUC SELECT *and* INSERT are fail-closed (0 rows / rejected)
 *   - shafenkhan@users.noreply.github.com has EXACTLY ONE active membership: MANAGER@GFL,
 *     and a REVOKED Magic-Unicorn row (isDefault=false)
 * and resolves the project owner via `(SELECT id FROM users LIMIT 1)`.
 *
 * NOTHING else seeds those per-workspace projects/tasks:
 *   - prisma/seed.ts seeds USERS (+ the legacy `magic-unicorn-org` Organization
 *     + PROJ-00x projects) but NO workspaceId-scoped, count-controlled fixtures;
 *   - scripts/seed-phase2-tenancy.ts seeds the two WORKSPACES + memberships only.
 * So this file plants the missing per-workspace rows the §9 test counts.
 *
 * RUN AS THE OWNER / ADMIN CONNECTION (process.env.DATABASE_URL). That role is
 * BYPASSRLS, which is REQUIRED here: a NOBYPASSRLS connection can only ever write
 * into ONE workspace (its GUC), but the fixtures must plant rows in BOTH MU and
 * GFL. The §9 test itself is the part that connects as project_ops_app; the seed
 * is owner-side setup. (We assert below that we are NOT accidentally on the
 * fenced role, else the second-workspace writes would silently vanish.)
 *
 * MEMBERSHIP KEYING (why this file owns the membership truth):
 *   The §9 Invariant-5 query JOINs `users.keycloakId = memberships.userKey`. So
 *   the memberships the test reads MUST be keyed by keycloakId, NOT the local
 *   user id. prisma/seed.ts creates users with keycloakId=NULL, so seed:phase2's
 *   `keycloakId ?? id` fallback would key Shafen's rows by his LOCAL id — which
 *   that JOIN would never see. We therefore (a) pin a STABLE keycloakId on both
 *   operators here, then (b) re-declare the authoritative membership truth keyed
 *   by keycloakId (Aaron OWNER@MU active; Shafen MANAGER@GFL active + a REVOKED
 *   Magic-Unicorn row so Invariant-5's `muRow` exists). This makes the seed
 *   self-sufficient and order-independent of seed:phase2.
 *
 * SAFETY — writes ONLY to the two test workspaces:
 *   Every project/task mutation is scoped by workspaceId IN (MU, GFL). The
 *   delete-then-insert reconcile for projects/tasks deletes ONLY rows whose
 *   workspaceId is one of the two test workspaces (and only the two reserved
 *   projectNumbers P-1/P-2 within them). It NEVER touches any other workspace's
 *   data. Idempotent: safe to re-run any number of times.
 */

import {
  PrismaClient,
  ProjectStatus,
  ProjectPriority,
  TaskStatus,
  TaskType,
  TaskPriority,
  WorkspaceRole,
  MembershipStatus,
  UserRole,
} from '@prisma/client';

// --- Known dogfood ids (must match the §9 test + seed migration literals) ----
const MU = '0190a000-7e57-7000-8000-00000000b007'; // Magic Unicorn
const GFL = '01924a3c-0000-7f1a-beef-67f1ab5c0001'; // Brightwater Labs

// The ONLY two workspaces this seed is ever allowed to write into.
const TEST_WORKSPACE_IDS = [MU, GFL] as const;

// Reserved projectNumbers reused in BOTH workspaces (projectNumber is unique
// PER workspace — see Project @@unique([workspaceId, projectNumber])).
const PROJECT_NUMBERS = ['P-1', 'P-2'] as const;

// Stable keycloakId values so memberships key consistently across re-runs and so
// the §9 Invariant-5 JOIN (users.keycloakId = memberships.userKey) resolves.
const AARON_EMAIL = 'aaron@magicunicorn.tech';
const AARON_KEYCLOAK_ID = 'kc-test-aaron';
const SHAFEN_EMAIL = 'shafenkhan@users.noreply.github.com';
const SHAFEN_KEYCLOAK_ID = 'kc-test-shafen';

const prisma = new PrismaClient();

/**
 * Ensure a user exists with a STABLE keycloakId. We only create if absent
 * (prisma/seed.ts normally created them already); we always pin keycloakId so the
 * membership key is deterministic. username must be unique, so derive it from the
 * email local-part and keep it stable.
 */
async function ensureUser(
  email: string,
  keycloakId: string,
  firstName: string,
  lastName: string,
  role: UserRole,
): Promise<{ id: string; keycloakId: string }> {
  const username = email.split('@')[0];
  const user = await prisma.user.upsert({
    where: { email },
    update: { keycloakId },
    create: {
      email,
      username,
      firstName,
      lastName,
      role,
      keycloakId,
      isActive: true,
    },
    select: { id: true, keycloakId: true },
  });
  // keycloakId is non-null after the upsert; assert for the caller's types.
  return { id: user.id, keycloakId: user.keycloakId as string };
}

/**
 * Re-declare the authoritative membership truth keyed by keycloakId so the §9
 * Invariant-5 JOIN resolves. Memberships are a control table (NOT RLS-fenced).
 */
async function seedMemberships(
  aaronKey: string,
  shafenKey: string,
): Promise<void> {
  // Aaron: OWNER of Magic Unicorn, ACTIVE, default primary.
  await prisma.membership.upsert({
    where: { userKey_workspaceId: { userKey: aaronKey, workspaceId: MU } },
    update: {
      role: WorkspaceRole.OWNER,
      status: MembershipStatus.ACTIVE,
      isDefault: true,
    },
    create: {
      userKey: aaronKey,
      workspaceId: MU,
      role: WorkspaceRole.OWNER,
      status: MembershipStatus.ACTIVE,
      isDefault: true,
    },
  });

  // Shafen: MANAGER of Brightwater Labs, ACTIVE, default primary.
  await prisma.membership.upsert({
    where: { userKey_workspaceId: { userKey: shafenKey, workspaceId: GFL } },
    update: {
      role: WorkspaceRole.MANAGER,
      status: MembershipStatus.ACTIVE,
      isDefault: true,
    },
    create: {
      userKey: shafenKey,
      workspaceId: GFL,
      role: WorkspaceRole.MANAGER,
      status: MembershipStatus.ACTIVE,
      isDefault: true,
    },
  });

  // Shafen: a REVOKED Magic-Unicorn row (Invariant-5 asserts this row exists,
  // status=REVOKED, isDefault=false). Models the Phase-1 bootstrap OWNER row
  // that strict-isolation reconcile revoked. Upsert -> always REVOKED.
  await prisma.membership.upsert({
    where: { userKey_workspaceId: { userKey: shafenKey, workspaceId: MU } },
    update: {
      status: MembershipStatus.REVOKED,
      isDefault: false,
    },
    create: {
      userKey: shafenKey,
      workspaceId: MU,
      role: WorkspaceRole.OWNER,
      status: MembershipStatus.REVOKED,
      isDefault: false,
    },
  });
}

/**
 * Plant EXACTLY 2 projects + 1 task per test workspace. delete-then-insert so
 * the counts are EXACT and re-runs are clean. Scoped strictly to the two test
 * workspaces + the two reserved projectNumbers — never touches other data.
 *
 * Required (non-null, no-default) fields driven from schema.prisma:
 *   Project: workspaceId, projectNumber, title, clientName, createdById
 *            (status/priority have defaults but we set them for clarity).
 *   Task:    workspaceId, projectId, title, createdById
 *            (type/status/priority have defaults).
 */
async function seedProjectsAndTasks(createdById: string): Promise<void> {
  // Tasks FK -> projects (onDelete: Cascade), so deleting the reserved projects
  // also removes their tasks. Delete ONLY within the two test workspaces and
  // ONLY the reserved projectNumbers.
  await prisma.project.deleteMany({
    where: {
      workspaceId: { in: [...TEST_WORKSPACE_IDS] },
      projectNumber: { in: [...PROJECT_NUMBERS] },
    },
  });

  for (const workspaceId of TEST_WORKSPACE_IDS) {
    for (const projectNumber of PROJECT_NUMBERS) {
      const project = await prisma.project.create({
        data: {
          workspaceId,
          projectNumber,
          title: `RLS fixture ${projectNumber} (${workspaceId})`,
          clientName: 'RLS Fixture Client',
          status: ProjectStatus.NEW,
          priority: ProjectPriority.MEDIUM,
          createdById,
        },
        select: { id: true },
      });

      // EXACTLY ONE task per workspace: attach it to the first project (P-1).
      if (projectNumber === PROJECT_NUMBERS[0]) {
        await prisma.task.create({
          data: {
            workspaceId,
            projectId: project.id,
            title: `RLS fixture task (${workspaceId})`,
            type: TaskType.TASK,
            status: TaskStatus.PENDING,
            priority: TaskPriority.MEDIUM,
            createdById,
          },
        });
      }
    }
  }
}

async function main(): Promise<void> {
  console.log('[seed:rls-fixtures] Seeding §9 RLS test fixtures...');

  // GUARD: we MUST be on a BYPASSRLS connection (the owner/admin URL), otherwise
  // the second-workspace writes would be silently fenced away by RLS.
  const role = await prisma.$queryRaw<
    { current_user: string; rolbypassrls: boolean }[]
  >`SELECT current_user, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
  const me = role[0];
  if (!me) throw new Error('could not resolve current_user role attributes');
  if (!me.rolbypassrls) {
    throw new Error(
      `[seed:rls-fixtures] must run as the OWNER/admin (BYPASSRLS) connection so ` +
        `it can plant rows in BOTH test workspaces; connected as ` +
        `'${me.current_user}' (rolbypassrls=false). Point DATABASE_URL at the ` +
        `owner/admin role (NOT project_ops_app).`,
    );
  }

  // Ensure both workspaces exist (the seed migration / seed:phase2 create them;
  // upsert here so this seed is self-sufficient if run standalone). Touch ONLY
  // these two ids.
  await prisma.workspace.upsert({
    where: { id: MU },
    update: {},
    create: {
      id: MU,
      slug: 'magic-unicorn',
      displayName: 'Magic Unicorn',
      isolationMode: 'standard',
      isolationTier: 'shared',
      status: 'active',
    },
  });
  await prisma.workspace.upsert({
    where: { id: GFL },
    update: {},
    create: {
      id: GFL,
      slug: 'brightwater-labs',
      displayName: 'Brightwater Labs',
      isolationMode: 'standard',
      isolationTier: 'shared',
      status: 'active',
    },
  });

  const aaron = await ensureUser(
    AARON_EMAIL,
    AARON_KEYCLOAK_ID,
    'Aaron',
    'Stransky',
    UserRole.ADMIN,
  );
  await ensureUser(
    SHAFEN_EMAIL,
    SHAFEN_KEYCLOAK_ID,
    'Shafen',
    'Khan',
    UserRole.MANAGER,
  );

  await seedMemberships(aaron.keycloakId, SHAFEN_KEYCLOAK_ID);

  // Owner for the fixture rows. The §9 cross-ws INSERT uses
  // `(SELECT id FROM users LIMIT 1)`, so any real user id satisfies its FK; we
  // use Aaron's id for the seeded projects/tasks.
  await seedProjectsAndTasks(aaron.id);

  // Sanity: confirm the EXACT per-workspace project counts the §9 test asserts.
  for (const workspaceId of TEST_WORKSPACE_IDS) {
    const count = await prisma.project.count({ where: { workspaceId } });
    console.log(`[seed:rls-fixtures]   ${workspaceId}: ${count} project(s)`);
    if (count !== PROJECT_NUMBERS.length) {
      throw new Error(
        `[seed:rls-fixtures] expected exactly ${PROJECT_NUMBERS.length} ` +
          `projects in ${workspaceId} but found ${count}. The §9 test will ` +
          `fail — another seed planted extra projects in this workspace.`,
      );
    }
  }

  console.log('[seed:rls-fixtures] Done. Fixtures only ever touch MU + GFL.');
}

main()
  .catch((e) => {
    console.error('[seed:rls-fixtures] error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
