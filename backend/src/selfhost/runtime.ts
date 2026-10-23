import { randomBytes, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { BootstrapIdentity } from './bootstrap-plan';

interface RuntimeConfig extends BootstrapIdentity {
  postgresPassword: string;
  appPassword: string;
  jwtSecret: string;
  emailEncryptionKey: string;
}

function configPath(): string {
  const path = process.env.PROJECT_OPS_SELFHOST_CONFIG;
  if (!path) throw new Error('PROJECT_OPS_SELFHOST_CONFIG is required');
  return path;
}

export function parseRuntimeConfig(raw: string): RuntimeConfig {
  const config: RuntimeConfig = JSON.parse(raw);
  if (
    !config ||
    ![
      config.postgresPassword,
      config.appPassword,
      config.jwtSecret,
      config.emailEncryptionKey,
    ].every((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) ||
    !/^admin-[a-f0-9]{24}@example\.invalid$/.test(config.adminEmail) ||
    !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(config.workspaceId)
  ) {
    throw new Error('Invalid self-host configuration; refusing to replace persisted secrets');
  }
  return config;
}

export function readRuntimeConfig(): RuntimeConfig {
  return parseRuntimeConfig(readFileSync(configPath(), 'utf8'));
}

export function databaseUrl(config: RuntimeConfig, admin = false): string {
  const user = admin ? 'project_ops_admin' : 'project_ops_app';
  const password = admin ? config.postgresPassword : config.appPassword;
  return `postgresql://${user}:${password}@postgres:5432/project_ops?schema=public`;
}

export function runtimeEnvironment(config: RuntimeConfig) {
  return {
    DATABASE_URL: databaseUrl(config),
    JWT_SECRET: config.jwtSecret,
    EMAIL_ENCRYPTION_KEY: config.emailEncryptionKey,
    DEFAULT_WORKSPACE_ID: config.workspaceId,
    PROJECT_OPS_ACCESS_LIST: `${config.adminEmail}:ADMIN`,
  };
}

/** Init container only: secrets persist outside the checkout, never on stdout. */
function initializeRuntime() {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    const config: RuntimeConfig = {
      postgresPassword: randomBytes(32).toString('hex'),
      appPassword: randomBytes(32).toString('hex'),
      jwtSecret: randomBytes(32).toString('hex'),
      emailEncryptionKey: randomBytes(32).toString('hex'),
      adminEmail: `admin-${randomBytes(12).toString('hex')}@example.invalid`,
      workspaceId: randomUUID(),
    };
    // Only the init service writes this volume. Other services mount it read-only.
    writeFileSync(path, JSON.stringify(config), { flag: 'wx', mode: 0o444 });
  }
  const config = readRuntimeConfig();
  const passwordPath = join(dirname(path), 'postgres-password');
  if (!existsSync(passwordPath)) {
    writeFileSync(passwordPath, config.postgresPassword, { flag: 'wx', mode: 0o444 });
  } else if (readFileSync(passwordPath, 'utf8') !== config.postgresPassword) {
    throw new Error('Persisted database password files disagree');
  }
}

if (require.main === module) {
  try {
    initializeRuntime();
  } catch {
    // File/JSON errors may contain secret material. Never log their contents.
    console.error('Self-host secret initialization failed; inspect volume permissions and backups');
    process.exitCode = 1;
  }
}
