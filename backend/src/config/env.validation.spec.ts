/**
 * Tests for the boot-time env validator (item 3). Pins the fail-closed
 * behavior for JWT_SECRET + EMAIL_ENCRYPTION_KEY in production, and that
 * dev/test stays permissive so local boot + the suite don't need full secrets.
 */
import { validateEnv } from './env.validation';

const HEX64 = 'a'.repeat(64);
const STRONG_JWT = 'x'.repeat(40);

const baseProd = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://project_ops_app:REMOVED@db:5432/project_ops',
  JWT_SECRET: STRONG_JWT,
  EMAIL_ENCRYPTION_KEY: HEX64,
};

describe('validateEnv', () => {
  it('accepts a fully-populated production config', () => {
    expect(() => validateEnv({ ...baseProd })).not.toThrow();
  });

  it('returns the original config untouched on success', () => {
    const cfg = { ...baseProd, EXTRA_UNVALIDATED: 'kept' };
    expect(validateEnv(cfg)).toBe(cfg);
  });

  it('throws when DATABASE_URL is missing (any environment)', () => {
    const { DATABASE_URL, ...rest } = baseProd;
    void DATABASE_URL;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws in production when JWT_SECRET is unset', () => {
    const { JWT_SECRET, ...rest } = baseProd;
    void JWT_SECRET;
    expect(() => validateEnv(rest)).toThrow(/JWT_SECRET/);
  });

  it('throws in production when JWT_SECRET is too weak', () => {
    expect(() => validateEnv({ ...baseProd, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('throws in production when EMAIL_ENCRYPTION_KEY is unset', () => {
    const { EMAIL_ENCRYPTION_KEY, ...rest } = baseProd;
    void EMAIL_ENCRYPTION_KEY;
    expect(() => validateEnv(rest)).toThrow(/EMAIL_ENCRYPTION_KEY/);
  });

  it('throws in production when EMAIL_ENCRYPTION_KEY is the wrong length', () => {
    expect(() => validateEnv({ ...baseProd, EMAIL_ENCRYPTION_KEY: 'abc123' })).toThrow(
      /EMAIL_ENCRYPTION_KEY/,
    );
  });

  it('does NOT require JWT_SECRET / EMAIL_ENCRYPTION_KEY outside production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://localhost/project_ops',
      }),
    ).not.toThrow();
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => validateEnv({ ...baseProd, PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('rejects a non-boolean KEYCLOAK_ENFORCE_AUDIENCE', () => {
    expect(() => validateEnv({ ...baseProd, KEYCLOAK_ENFORCE_AUDIENCE: 'maybe' })).toThrow(
      /KEYCLOAK_ENFORCE_AUDIENCE/,
    );
  });

  it('accepts string boolean forms for flags', () => {
    expect(() =>
      validateEnv({
        ...baseProd,
        KEYCLOAK_ENFORCE_AUDIENCE: 'false',
        PROJECT_OPS_TENANCY_ENABLED: 'true',
      }),
    ).not.toThrow();
  });

  // --- uc-registry (Phase E) — optional vars must not break boot. ---
  it('accepts UC_REGISTRY_URL when present, and tolerates it absent (optional)', () => {
    expect(() => validateEnv({ ...baseProd })).not.toThrow(); // absent
    expect(() =>
      validateEnv({ ...baseProd, UC_REGISTRY_URL: 'http://127.0.0.1:8081' }),
    ).not.toThrow();
  });

  it('rejects a non-numeric UC_REGISTRY_TIMEOUT_MS', () => {
    expect(() => validateEnv({ ...baseProd, UC_REGISTRY_TIMEOUT_MS: 'soon' })).toThrow(
      /UC_REGISTRY_TIMEOUT_MS/,
    );
  });
});
