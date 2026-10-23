import { randomBytes, randomUUID } from 'crypto';
import { hash } from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { bootstrapAction, bootstrapRecords, requireBootstrapTerminal } from './bootstrap-plan';
import { databaseUrl, readRuntimeConfig } from './runtime';

export async function bootstrapAdmin() {
  requireBootstrapTerminal(!!process.stdin.isTTY, !!process.stdout.isTTY);
  const config = readRuntimeConfig();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl(config) } } });
  try {
    const credentials = await prisma.$transaction(async (tx) => {
      // Serialize concurrent operator invocations, including the empty-db check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(32013200)`;
      const user = await tx.user.findUnique({ where: { email: config.adminEmail } });
      const membership = user
        ? await tx.membership.findUnique({
            where: { userKey_workspaceId: { userKey: user.id, workspaceId: config.workspaceId } },
          })
        : null;
      const ownerExists =
        user?.role === 'ADMIN' && membership?.role === 'OWNER' && membership.status === 'ACTIVE';
      if (
        bootstrapAction(await tx.user.count(), await tx.workspace.count(), ownerExists) ===
        'already-initialized'
      ) {
        return null;
      }
      const password = randomBytes(24).toString('base64url');
      const passwordHash = await hash(password, 12);
      const records = bootstrapRecords(config, randomUUID(), passwordHash);
      await tx.workspace.create({ data: records.workspace });
      await tx.user.create({ data: records.user });
      await tx.membership.create({ data: records.membership });
      return { email: config.adminEmail, password, passwordHash };
    });
    if (!credentials) {
      console.log('Bootstrap already completed; no credentials were changed or displayed');
      return;
    }
    // Runs via `compose exec` with a TTY, never as a container startup command.
    // Only the bcrypt hash is stored in Postgres. No credential file is written.
    process.stdout.write(
      `Save these credentials now; they will not be displayed again.\n` +
        `Email: ${credentials.email}\nPassword: ${credentials.password}\n` +
        `Password hash: ${credentials.passwordHash}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  bootstrapAdmin().catch(() => {
    console.error('Bootstrap failed; use an interactive terminal against a fresh self-host stack');
    process.exitCode = 1;
  });
}
