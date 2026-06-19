/**
 * Assistant-turn cost attribution (v1.11 follow-on).
 *
 * The Project-Ops assistant runs behind Unicorn Brigade. Today it uses a LOCAL,
 * free-tier model on the UC llama.cpp router (sovereign — $0 real spend), so the
 * truthful cost of a turn is $0. Brigade DOES return real token `usage` on a
 * successful reply, so we always record tokens; cost is derived from a small
 * price table here.
 *
 * Design (truthful, never fabricated):
 *   - A model with a CONFIGURED price (including a local model priced at 0)
 *     yields a real computed cost — $0 for the local model today.
 *   - An UNKNOWN / unpriced model yields `null` (the ledger shows "—"), so we
 *     never under-report a billed model's spend as $0 by accident.
 *
 * If the assistant is ever pointed at a BILLED model (cloud/frontier via
 * LiteLLM), add that model's price via the `ASSISTANT_TOKEN_PRICES` env (JSON)
 * and the real cost is computed from the returned usage. Prices are USD per
 * 1,000,000 tokens, split input/output — the same unit + split the UC gateway's
 * `cost_tracking.model_costs` table uses, so values can be copied across.
 */

export interface TokenPrice {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPerMTok: number;
  /** USD per 1,000,000 output (completion) tokens. */
  outputPerMTok: number;
}

/**
 * Known UC models. Local/sovereign models are free ($0). The assistant's current
 * model (`Qwen_Qwen3.6-35B-A3B-Q4_K_M`) and the prior `gemma-4-26B` are both
 * local → 0. Extend via the `ASSISTANT_TOKEN_PRICES` env for any billed model.
 * Keys match the `model` field Brigade returns on the chat reply.
 */
export const DEFAULT_TOKEN_PRICES: Record<string, TokenPrice> = {
  'Qwen_Qwen3.6-35B-A3B-Q4_K_M': { inputPerMTok: 0, outputPerMTok: 0 },
  'gemma-4-26B-A4B-it-UD-Q4_K_XL': { inputPerMTok: 0, outputPerMTok: 0 },
};

/**
 * Merge the optional `ASSISTANT_TOKEN_PRICES` env (JSON map of model →
 * `{inputPerMTok, outputPerMTok}`) over the defaults; env entries win. Malformed
 * JSON falls back to the defaults (never throws — this is on the reply path).
 */
export function loadTokenPrices(env?: string | null): Record<string, TokenPrice> {
  if (!env || !env.trim()) return DEFAULT_TOKEN_PRICES;
  try {
    const parsed = JSON.parse(env) as Record<string, Partial<TokenPrice>>;
    const merged: Record<string, TokenPrice> = { ...DEFAULT_TOKEN_PRICES };
    for (const [model, p] of Object.entries(parsed)) {
      const inP = Number(p?.inputPerMTok);
      const outP = Number(p?.outputPerMTok);
      if (Number.isFinite(inP) && Number.isFinite(outP)) {
        merged[model] = { inputPerMTok: inP, outputPerMTok: outP };
      }
    }
    return merged;
  } catch {
    return DEFAULT_TOKEN_PRICES;
  }
}

/**
 * Cost of one turn in USD, or `null` when it can't be priced truthfully:
 *   - the model is missing, OR
 *   - the model has no configured price (unknown → null, never 0-by-accident).
 * A configured FREE model (price 0) correctly returns 0. Rounded to 6dp to match
 * the `AgentEvent.costUsd` `Decimal(12,6)` column.
 */
export function computeTurnCostUsd(
  model: string | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  prices: Record<string, TokenPrice> = DEFAULT_TOKEN_PRICES,
): number | null {
  if (!model) return null;
  const price = prices[model];
  if (!price) return null;
  const tin = typeof tokensIn === 'number' && Number.isFinite(tokensIn) ? tokensIn : 0;
  const tout = typeof tokensOut === 'number' && Number.isFinite(tokensOut) ? tokensOut : 0;
  const cost = (tin / 1_000_000) * price.inputPerMTok + (tout / 1_000_000) * price.outputPerMTok;
  return Math.round(cost * 1e6) / 1e6;
}
