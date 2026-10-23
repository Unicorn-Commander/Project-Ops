import { bootstrapAction, bootstrapRecords, requireBootstrapTerminal } from './bootstrap-plan';
import { parseRuntimeConfig, runtimeEnvironment } from './runtime';

const identity = {
  adminEmail: `admin-${'a'.repeat(24)}@example.invalid`,
  workspaceId: '11111111-1111-4111-8111-111111111111',
};
const userId = '22222222-2222-4222-8222-222222222222';
// Synthetic hash-shaped fixture; no shared login credential is created.
const passwordHash = '$2b$12$' + 'a'.repeat(53);
const config = {
  ...identity,
  postgresPassword: '1'.repeat(64),
  appPassword: '2'.repeat(64),
  jwtSecret: '3'.repeat(64),
  emailEncryptionKey: '4'.repeat(64),
};

describe('self-host bootstrap plan (no database)', () => {
  it('creates one active local admin and a default OWNER membership in the same workspace', () => {
    const records = bootstrapRecords(identity, userId, passwordHash);
    expect(records.user).toMatchObject({
      id: userId,
      email: identity.adminEmail,
      password: passwordHash,
      role: 'ADMIN',
      isActive: true,
    });
    expect(records.workspace.id).toBe(identity.workspaceId);
    expect(records.membership).toEqual({
      userKey: userId,
      workspaceId: identity.workspaceId,
      role: 'OWNER',
      status: 'ACTIVE',
      isDefault: true,
    });
    expect(records.user).not.toHaveProperty('keycloakId');
  });

  it.each(['plaintext-password', '$2b$10$' + 'a'.repeat(53), ''])(
    'refuses invalid password hashes',
    (value) => {
      expect(() => bootstrapRecords(identity, userId, value)).toThrow('bcrypt hash');
    },
  );

  it('refuses supplied operator emails or malformed identities', () => {
    expect(() =>
      bootstrapRecords({ ...identity, adminEmail: 'owner@example.com' }, userId, passwordHash),
    ).toThrow('identity');
    expect(() => bootstrapRecords({ ...identity, workspaceId: '' }, userId, passwordHash)).toThrow(
      'identifier',
    );
  });

  it('creates only in an empty installation and leaves an existing owner unchanged', () => {
    expect(bootstrapAction(0, 0, false)).toBe('create');
    expect(bootstrapAction(1, 1, true)).toBe('already-initialized');
    expect(bootstrapAction(4, 2, true)).toBe('already-initialized');
  });

  it.each([
    [1, 0],
    [0, 1],
    [1, 1],
  ])(
    'refuses an unrelated existing installation (%s users, %s workspaces)',
    (users, workspaces) => {
      expect(() => bootstrapAction(users, workspaces, false)).toThrow(
        'existing data will not be changed',
      );
    },
  );

  it.each([
    [false, false],
    [false, true],
    [true, false],
  ])('refuses redirected or noninteractive credentials', (input, output) => {
    expect(() => requireBootstrapTerminal(input, output)).toThrow('interactive terminal');
  });

  it('allows an interactive operator terminal', () => {
    expect(() => requireBootstrapTerminal(true, true)).not.toThrow();
  });
});

describe('persisted runtime configuration', () => {
  it('loads the same identity, encryption key and secrets on every boot', () => {
    expect(parseRuntimeConfig(JSON.stringify(config))).toEqual(config);
    const env = runtimeEnvironment(config);
    expect(env.DATABASE_URL).toContain('project_ops_app:');
    expect(env.DATABASE_URL).not.toContain(config.postgresPassword);
    expect(env.EMAIL_ENCRYPTION_KEY).toBe(config.emailEncryptionKey);
    expect(env.DEFAULT_WORKSPACE_ID).toBe(identity.workspaceId);
    expect(env.PROJECT_OPS_ACCESS_LIST).toBe(`${identity.adminEmail}:ADMIN`);
  });

  it.each([
    'postgresPassword',
    'appPassword',
    'jwtSecret',
    'emailEncryptionKey',
    'adminEmail',
    'workspaceId',
  ])('refuses corrupt %s instead of rotating persisted configuration', (field) => {
    expect(() => parseRuntimeConfig(JSON.stringify({ ...config, [field]: '' }))).toThrow();
  });
});
