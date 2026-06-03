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
