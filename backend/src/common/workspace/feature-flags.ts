/**
 * Feature flags for the time-tracking + billable-rollup spine.
 *
 * - TIME_TRACKING_ENABLED (default ON): master switch. When 'false', the REST
 *   controllers 404 and the MCP time tools are not registered.
 * - BILLABLE_ROLLUP_LIVE (default OFF): when ON, the rollup attempts the live
 *   Brigade-brokered Accounting-Ops `create_invoice_from_draft` call. When OFF
 *   (or when the live call is not entitled/unreachable), the rollup produces a
 *   draft + PDF preview and surfaces "connect Accounting-Ops to invoice".
 *
 * Both default-read process.env (which @nestjs/config populates from .env), so
 * the same helpers work in DI services and in the non-DI MCP tool layer.
 */

type EnvGetter = (key: string) => string | undefined;

const defaultGetter: EnvGetter = (k) => process.env[k];

function truthy(value: string | undefined | null, fallback: boolean): boolean {
  if (value == null || value === '') return fallback;
  const s = value.toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export function timeTrackingEnabled(getEnv: EnvGetter = defaultGetter): boolean {
  // Default ON: only an explicit falsey value disables it.
  return truthy(getEnv('TIME_TRACKING_ENABLED'), true);
}

export function billableRollupLive(getEnv: EnvGetter = defaultGetter): boolean {
  // Default OFF: the live AO call needs AO entitlement + Brigade mint wired.
  return truthy(getEnv('BILLABLE_ROLLUP_LIVE'), false);
}

/**
 * Suite tenancy master switch (SUITE-IDENTITY / PROJ-2026-000023).
 *
 * Default OFF == today's behavior: workspace routes do NOT require a
 * Membership row, the membership gate is a no-op, and rows resolve to
 * DEFAULT_WORKSPACE_ID. RLS exists in the DB but is inert because the runtime
 * still connects as the table owner.
 *
 * When ON (a later rollout phase, alongside flipping the runtime DATABASE_URL
 * to the NOBYPASSRLS project_ops_app role): workspace routes 403 without an
 * active Membership, and the membership-derived workspace drives the RLS GUC.
 */
export function tenancyEnabled(getEnv: EnvGetter = defaultGetter): boolean {
  return truthy(getEnv('PROJECT_OPS_TENANCY_ENABLED'), false);
}
