/**
 * Startup environment validation (PO security-hardening item 3).
 *
 * Wired into `ConfigModule.forRoot({ validate })` so it runs ONCE at boot,
 * before any provider is constructed. If a required var is missing/weak the
 * process exits with a clear, aggregated error instead of failing later in a
 * confusing way (e.g. a 500 on the first login, or — worse — silently
 * encrypting SMTP passwords under a throwaway key).
 *
 * We use `class-validator` + `class-transformer` here (not Joi/zod) because
 * they are already first-class `dependencies` and the repo's canonical
 * validation mechanism — every DTO is validated by the same libraries via the
 * global ValidationPipe. This keeps one validation idiom across the codebase
 * and adds no new dependency.
 *
 * Production vs non-production: secrets that are merely a footgun in dev are a
 * HARD failure in production (NODE_ENV=production). In dev/test they stay
 * optional so local boot + the test suite don't need a full secret set.
 */
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
  ValidateIf,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const isProd = (env: Record<string, unknown>): boolean =>
  (env.NODE_ENV ?? 'production') === NodeEnv.Production;

/** Coerce common truthy/falsey env strings to a boolean for @IsBoolean. */
const toBool = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const s = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return value; // let @IsBoolean flag anything else
};

export class EnvironmentVariables {
  @IsOptional()
  @IsIn(Object.values(NodeEnv))
  NODE_ENV: NodeEnv = NodeEnv.Production;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  PORT?: number;

  // --- Database (always required: the app cannot run without it) ---
  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  // --- JWT (local client-portal sessions) ---
  // Required + min length in production; a weak/empty secret silently breaks
  // local-session signing & verification. NOTE: NO @IsOptional() here — it
  // would short-circuit the whole chain when the value is ABSENT, which is
  // exactly the case we must reject. @ValidateIf gates the prod-only behavior:
  // outside production the chain is skipped entirely (so the value stays
  // optional in dev/test).
  @ValidateIf((o: EnvironmentVariables) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  @IsNotEmpty({
    message: 'JWT_SECRET is required in production (generate: openssl rand -base64 64)',
  })
  @MinLength(32, {
    message: 'JWT_SECRET must be at least 32 characters in production',
  })
  JWT_SECRET?: string;

  // --- Email field-encryption key ---
  // A stored SMTP password is encrypted under this key. A random per-process
  // fallback makes it undecryptable after restart, so in production it MUST be
  // present and a valid 64-char hex (32 bytes) string. (No @IsOptional — see
  // JWT_SECRET above.)
  @ValidateIf((o: EnvironmentVariables) => o.NODE_ENV === NodeEnv.Production)
  @IsString()
  @IsNotEmpty({
    message: 'EMAIL_ENCRYPTION_KEY is required in production (generate: openssl rand -hex 32)',
  })
  @MinLength(64, {
    message: 'EMAIL_ENCRYPTION_KEY must be a 64-char hex string (openssl rand -hex 32)',
  })
  EMAIL_ENCRYPTION_KEY?: string;

  // --- Keycloak audience binding (item 1) — optional, but type-checked. ---
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  KEYCLOAK_ENFORCE_AUDIENCE?: boolean;

  // --- Tenancy master switch (item 2) — optional, type-checked. ---
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  PROJECT_OPS_TENANCY_ENABLED?: boolean;

  // --- uc-registry (Phase E) — OPTIONAL. When unset the registry client is a
  // pure no-op (workspace creation behaves exactly as today). When set, PO
  // registers each workspace it creates with uc-registry (the suite SoR). Just
  // type-checked here as an optional string; reachability is verified at deploy
  // time per docs/PHASE-E-PROD-RUNBOOK.md. ---
  @IsOptional()
  @IsString()
  UC_REGISTRY_URL?: string;

  // Optional per-request timeout (ms) for uc-registry calls; defaults to 5000.
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? value : Number(value)))
  @IsInt()
  UC_REGISTRY_TIMEOUT_MS?: number;
}

/**
 * The `validate` hook ConfigModule.forRoot expects. Throws (aborting boot) when
 * any constraint fails, aggregating every error into one message so a
 * misconfigured deploy gets the full list at once.
 *
 * Returns the original config untouched on success — we do NOT replace
 * `process.env` semantics; downstream code keeps reading via ConfigService as
 * before. `forbidNonWhitelisted` is OFF deliberately: the app has many more env
 * vars (MinIO, Redis, SMTP, Brigade, inference URLs, …) than we validate here,
 * and rejecting unknown keys would break them.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    forbidNonWhitelisted: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((e) => Object.values(e.constraints ?? { unknown: `${e.property} is invalid` }))
      .flat()
      .join('; ');
    const mode = isProd(config) ? 'production' : 'non-production';
    throw new Error(
      `Invalid environment configuration (${mode}): ${details}. ` +
        `See backend/.env.example for the required values.`,
    );
  }

  return config;
}
