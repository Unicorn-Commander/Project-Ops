import { spawnSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { databaseUrl, readRuntimeConfig, runtimeEnvironment } from './runtime';

async function start() {
  const config = readRuntimeConfig();
  const accessList = process.env.PROJECT_OPS_ACCESS_LIST?.trim();
  Object.assign(process.env, runtimeEnvironment(config));
  if (accessList) process.env.PROJECT_OPS_ACCESS_LIST = accessList;

  // Match this repo's db-push workflow. Never accept data loss or run dogfood seeds.
  const schema = spawnSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'],
    { env: { ...process.env, DATABASE_URL: databaseUrl(config, true) }, stdio: 'pipe' },
  );
  if (schema.status !== 0) throw new Error('Schema initialization failed');

  const admin = new PrismaClient({ datasources: { db: { url: databaseUrl(config, true) } } });
  try {
    // Fresh self-host is single-workspace. Use a non-superuser for runtime DML;
    // the hosted tenancy/RLS migrations are a separate, operator-managed path.
    await admin.$executeRawUnsafe(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_ops_app') THEN
        CREATE ROLE project_ops_app NOLOGIN;
      END IF;
    END $$`);
    // parseRuntimeConfig only permits hex, so this cannot escape the SQL literal.
    await admin.$executeRawUnsafe(
      `ALTER ROLE project_ops_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${config.appPassword}'`,
    );
    await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO project_ops_app');
    await admin.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO project_ops_app',
    );
    await admin.$executeRawUnsafe(
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO project_ops_app',
    );
    await admin.$executeRawUnsafe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "uq_time_entry_one_running" ON "time_entries" ("userId") WHERE "endedAt" IS NULL',
    );
  } finally {
    await admin.$disconnect();
  }

  // Load Nest only after the persisted environment is in place.
  await import('../main');
}

start().catch(() => {
  console.error(
    'Self-host startup failed during configuration/schema setup; no credentials logged',
  );
  process.exitCode = 1;
});
