import {
  computeTurnCostUsd,
  DEFAULT_TOKEN_PRICES,
  loadTokenPrices,
} from './assistant-pricing';

describe('assistant-pricing', () => {
  describe('computeTurnCostUsd', () => {
    it('returns 0 for the local free-tier model (priced at 0)', () => {
      expect(
        computeTurnCostUsd('Qwen_Qwen3.6-35B-A3B-Q4_K_M', 5072, 226),
      ).toBe(0);
    });

    it('returns null for an unknown / unpriced model (never 0-by-accident)', () => {
      expect(computeTurnCostUsd('some-future-cloud-model', 1000, 1000)).toBeNull();
    });

    it('returns null when the model is missing', () => {
      expect(computeTurnCostUsd(null, 1000, 1000)).toBeNull();
      expect(computeTurnCostUsd(undefined, 1000, 1000)).toBeNull();
    });

    it('computes real cost for a configured billed model, split in/out', () => {
      const prices = {
        'openai/gpt-4o': { inputPerMTok: 5, outputPerMTok: 15 },
      };
      // 1000 in @ $5/Mtok = 0.005 ; 2000 out @ $15/Mtok = 0.03 ; total 0.035
      expect(computeTurnCostUsd('openai/gpt-4o', 1000, 2000, prices)).toBe(0.035);
    });

    it('treats missing/non-finite token counts as 0', () => {
      const prices = { m: { inputPerMTok: 5, outputPerMTok: 15 } };
      expect(computeTurnCostUsd('m', null, null, prices)).toBe(0);
      expect(computeTurnCostUsd('m', undefined, 1_000_000, prices)).toBe(15);
    });

    it('rounds to 6 decimal places (the Decimal(12,6) column precision)', () => {
      const prices = { m: { inputPerMTok: 1, outputPerMTok: 0 } };
      // 7 tokens @ $1/Mtok = 0.000007 (exactly 6dp)
      expect(computeTurnCostUsd('m', 7, 0, prices)).toBe(0.000007);
    });
  });

  describe('loadTokenPrices', () => {
    it('returns the defaults when no env is provided', () => {
      expect(loadTokenPrices()).toBe(DEFAULT_TOKEN_PRICES);
      expect(loadTokenPrices('')).toBe(DEFAULT_TOKEN_PRICES);
    });

    it('falls back to defaults on malformed JSON (never throws on the reply path)', () => {
      expect(loadTokenPrices('{not valid json')).toBe(DEFAULT_TOKEN_PRICES);
    });

    it('merges env prices over the defaults (env wins)', () => {
      const merged = loadTokenPrices(
        JSON.stringify({ 'openai/gpt-4o': { inputPerMTok: 5, outputPerMTok: 15 } }),
      );
      // default local model preserved...
      expect(merged['Qwen_Qwen3.6-35B-A3B-Q4_K_M']).toEqual({
        inputPerMTok: 0,
        outputPerMTok: 0,
      });
      // ...and the env-configured billed model is added.
      expect(merged['openai/gpt-4o']).toEqual({ inputPerMTok: 5, outputPerMTok: 15 });
    });

    it('ignores env entries with non-numeric prices', () => {
      const merged = loadTokenPrices(
        JSON.stringify({ bad: { inputPerMTok: 'x', outputPerMTok: 1 } }),
      );
      expect(merged['bad']).toBeUndefined();
    });
  });
});
