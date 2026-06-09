/**
 * Phase 2 tenancy dogfood SEED — authoritative, idempotent.
 *
 * Governing spec: SUITE-IDENTITY.md (binding). Implementation brief:
 * docs/phase2-tenancy-blueprint.md (Phase C — C4). Companion to the migration
 * prisma/migrations/20260609120000_phase2_workspace_seed/migration.sql.
 *
 * Run with: `npm run seed:phase2`
 *
 * WHAT THIS DOES (all upserts — safe to run any number of times):
 *   1. Rebrands the bootstrap workspace 0190a000-…-b007 -> displayName
 *      "Magic Unicorn", slug "magic-unicorn" (it already holds ALL existing
 *      data).
 *   2. Ensures the second dogfood tenant "Brightwater Labs"
 *      (slug "brightwater-labs") exists at its HARDCODED uuidv7 literal.
 *   3. Pins the two AUTHORITATIVE operator memberships (these override
 *      PROJECT_OPS_ACCESS_LIST — R6):
 *        * aaron@magicunicorn.tech  -> OWNER   of Magic Unicorn      (isDefault)
 *        * shafenkhan@users.noreply.github.com   -> MANAGER of Brightwater Labs  (isDefault)
 *      and enforces STRICT workspace ISOLATION: each operator ends up with
 *      EXACTLY ONE active membership (the primary above). Every OTHER membership
 *      for that user is REVOKED (status=REVOKED), not merely demoted.
 *
 *   WHY REVOKE, NOT JUST DEMOTE (R6): an ACTIVE non-default membership still
 *   passes resolveAndAuthorize's membership gate, so a leftover Phase 1
 *   OWNER@Magic-Unicorn row would let shafenkhan@users.noreply.github.com switch
 *   (X-Workspace-Id) into Magic Unicorn and read Aaron's data. Setting
 *   status=REVOKED drops the row from listActiveMemberships (which filters
 *   status=ACTIVE), removing it from BOTH default-resolution and the switcher.
 *   Net effect: Shafen has no Magic Unicorn access, Aaron has no GFL access.
 *   We REVOKE (audit trail) rather than DELETE.
 *
 * SUITE-IDENTITY: PO MUST NOT runtime-mint workspace ids — uc-registry owns real
 * ids. The Brightwater Labs id is a dogfood SEED literal to be RECONCILED with
 * uc-registry in Phase E. It is a valid lowercase uuidv7.
 *
 * userKey contract: a Membership is keyed by userKey == uchub `sub` ==
 * User.keycloakId. We resolve userKey by EMAIL here. If the user row is not yet
 * SSO-linked (keycloakId is null), we fall back to the local user id so the
 * dogfood seed still resolves today (MembershipService.membershipKey applies the
 * identical `keycloakId ?? id` fallback at request time, so the key stays
 * consistent). If the user row does not exist at all, that membership is skipped
 * with a warning and can be re-run after the user first signs in.
 */

import { PrismaClient, MembershipStatus, WorkspaceRole } from '@prisma/client';

const prisma = new PrismaClient();

// --- Known dogfood ids (see migration header) -------------------------------
const MAGIC_UNICORN_ID = '0190a000-7e57-7000-8000-00000000b007';
// PO must NOT runtime-mint per SUITE-IDENTITY — this literal is a dogfood seed
// to RECONCILE with uc-registry in Phase E. Valid lowercase uuidv7.
const GENESIS_FLOW_LABS_ID = '01924a3c-0000-7f1a-beef-67f1ab5c0001';

interface SeedMembership {
  email: string;
  workspaceId: string;
  workspaceLabel: string;
  role: WorkspaceRole;
}

// The authoritative membership truth. Each row's workspace is that user's
// PRIMARY (isDefault=true); every OTHER membership for the user is demoted to
// isDefault=false so resolveAndAuthorize lands them here by default.
const AUTHORITATIVE_MEMBERSHIPS: SeedMembership[] = [
  {
    email: 'aaron@magicunicorn.tech',
    workspaceId: MAGIC_UNICORN_ID,
    workspaceLabel: 'Magic Unicorn',
    role: WorkspaceRole.OWNER,
  },
  {
    email: 'shafenkhan@users.noreply.github.com',
    workspaceId: GENESIS_FLOW_LABS_ID,
    workspaceLabel: 'Brightwater Labs',
    role: WorkspaceRole.MANAGER,
  },
];

async function main(): Promise<void> {
  console.log('[seed:phase2] Seeding Phase 2 dogfood tenancy...');

  // 1. Rebrand the bootstrap workspace -> "Magic Unicorn".
  //    Use upsert so a fresh DB (no Phase 1 INSERT yet) still gets a valid row.
  const magicUnicorn = await prisma.workspace.upsert({
    where: { id: MAGIC_UNICORN_ID },
    update: { displayName: 'Magic Unicorn', slug: 'magic-unicorn' },
    create: {
      id: MAGIC_UNICORN_ID,
      slug: 'magic-unicorn',
      displayName: 'Magic Unicorn',
      isolationMode: 'standard',
      isolationTier: 'shared',
      status: 'active',
    },
  });
  console.log(
    `[seed:phase2] Workspace ready: ${magicUnicorn.displayName} (${magicUnicorn.slug}) ${magicUnicorn.id}`,
  );

  // 2. Ensure the Brightwater Labs dogfood tenant exists.
  const genesisFlowLabs = await prisma.workspace.upsert({
    where: { id: GENESIS_FLOW_LABS_ID },
    update: { displayName: 'Brightwater Labs', slug: 'brightwater-labs' },
    create: {
      id: GENESIS_FLOW_LABS_ID,
      slug: 'brightwater-labs',
      displayName: 'Brightwater Labs',
      isolationMode: 'standard',
      isolationTier: 'shared',
      status: 'active',
    },
  });
  console.log(
    `[seed:phase2] Workspace ready: ${genesisFlowLabs.displayName} (${genesisFlowLabs.slug}) ${genesisFlowLabs.id}`,
  );

  // 3. Authoritative operator memberships (override PROJECT_OPS_ACCESS_LIST).
  for (const m of AUTHORITATIVE_MEMBERSHIPS) {
    const user = await prisma.user.findUnique({
      where: { email: m.email },
      select: { id: true, keycloakId: true, email: true },
    });

    if (!user) {
      console.warn(
        `[seed:phase2] SKIP membership ${m.email} -> ${m.role}@${m.workspaceLabel}: ` +
          `no user row (re-run seed after the user first signs in).`,
      );
      continue;
    }

    // userKey == uchub sub == User.keycloakId; fall back to local id pre-link.
    // Matches MembershipService.membershipKey(keycloakId ?? id).
    const userKey = user.keycloakId ?? user.id;
    if (!user.keycloakId) {
      console.warn(
        `[seed:phase2] ${m.email} not yet SSO-linked (keycloakId null); ` +
          `seeding membership under local id ${user.id} as the userKey.`,
      );
    }

    // Idempotent upsert on (userKey, workspaceId): set role + ACTIVE + primary.
    await prisma.membership.upsert({
      where: { userKey_workspaceId: { userKey, workspaceId: m.workspaceId } },
      update: {
        role: m.role,
        status: MembershipStatus.ACTIVE,
        isDefault: true,
      },
      create: {
        userKey,
        workspaceId: m.workspaceId,
        role: m.role,
        status: MembershipStatus.ACTIVE,
        isDefault: true,
      },
    });

    // STRICT ISOLATION reconcile (R6): the authoritative row above is this
    // user's SOLE intended workspace, so REVOKE every OTHER membership for the
    // same userKey (e.g. the Phase 1 bootstrap OWNER row shafenkhan@users.noreply.github.com
    // got on Magic Unicorn). Demoting isDefault alone is NOT enough — an ACTIVE
    // non-default membership still passes resolveAndAuthorize's membership gate,
    // which would let Shafen switch into Magic Unicorn (Aaron's data). Setting
    // status=REVOKED removes the row from listActiveMemberships (status=ACTIVE
    // filter), so it disappears from both default-resolution and the switcher.
    // We REVOKE rather than DELETE (audit trail). Idempotent: re-running only
    // touches rows that are not already REVOKED. Result: each operator has
    // EXACTLY ONE active membership (the primary above).
    const revoked = await prisma.membership.updateMany({
      where: {
        userKey,
        workspaceId: { not: m.workspaceId },
        status: { not: MembershipStatus.REVOKED },
      },
      data: { status: MembershipStatus.REVOKED, isDefault: false },
    });

    console.log(
      `[seed:phase2] Membership: ${m.email} (userKey=${userKey}) -> ` +
        `${m.role}@${m.workspaceLabel} [default]` +
        (revoked.count > 0
          ? ` (revoked ${revoked.count} other membership(s) for strict isolation)`
          : ''),
    );
  }

  console.log('[seed:phase2] Done.');
}

main()
  .catch((e) => {
    console.error('[seed:phase2] error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
