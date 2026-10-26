import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

const repoRoot = resolve(__dirname, '../../..');
const backendRoot = join(repoRoot, 'backend');
const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
const localRlsHarness = readFileSync(join(backendRoot, 'tests/integration/rls/run.sh'), 'utf8');
const rlsSuite = readFileSync(
  join(backendRoot, 'tests/integration/rls/workspace-isolation.integration.test.ts'),
  'utf8',
);
const packageJson = JSON.parse(readFileSync(join(backendRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>;
};

function migrationList(text: string): string[] {
  const block = text.match(/MIGRATIONS=\(\n([\s\S]*?)\n\s*\)/);
  if (!block) throw new Error('could not find a MIGRATIONS array');
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe('backend CI RLS workflow contract', () => {
  it('applies the same complete tenancy migration sequence as the local harness', () => {
    const ciMigrations = migrationList(workflow);
    const localMigrations = migrationList(localRlsHarness);

    expect(ciMigrations).toEqual(localMigrations);
    expect(ciMigrations).toContain('20260617000000_phase3_workspace_not_null');

    for (const migration of ciMigrations) {
      expect(existsSync(join(backendRoot, 'prisma/migrations', migration, 'migration.sql'))).toBe(
        true,
      );
    }
  });

  it('keeps the seed paths and non-bypass RLS proof wired into CI', () => {
    expect(packageJson.scripts?.['prisma:seed']).toBe('ts-node prisma/seed.ts');
    expect(packageJson.scripts?.['seed:phase2']).toBe('ts-node scripts/seed-phase2-tenancy.ts');
    expect(existsSync(join(backendRoot, 'prisma/seed.ts'))).toBe(true);
    expect(existsSync(join(backendRoot, 'scripts/seed-phase2-tenancy.ts'))).toBe(true);
    expect(existsSync(join(backendRoot, 'tests/integration/rls/seed-rls-fixtures.ts'))).toBe(true);

    expect(workflow).toContain('PROJECT_OPS_APP_DATABASE_URL:');
    expect(workflow).toContain('run: npm run test:rls');
    expect(workflow).toContain('INVITATION_ADMIN_DATABASE_URL:');
    expect(workflow).toContain('INVITATION_APP_DATABASE_URL:');
    expect(workflow).toContain('psql -v ON_ERROR_STOP=1');
    expect(rlsSuite).toMatch(/rolbypassrls/);
    expect(rlsSuite).toMatch(/rolsuper/);
    expect(rlsSuite).toMatch(/RLS proof must run as a NOBYPASSRLS/);
  });
});
