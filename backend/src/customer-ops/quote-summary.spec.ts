import {
  CLIENT_QUOTE_SUMMARY_KEYS,
  QuoteSummary,
  maskProjectQuoteRefForClient,
  maskQuoteSummaryForClient,
  normalizeQuoteSummary,
  readCachedQuoteSummary,
  readProjectQuoteRef,
  summaryFromCache,
} from './quote-summary';

/**
 * The CLIENT mask is the load-bearing privacy rule of the seam (contract §5,
 * task brief): number, title, totals, status, share link — nothing else, ever.
 */
const REF = {
  customer_ops_quote_id: 'q-0001',
  number: 'Q-2026-0001',
  version: 1,
  share_url: 'https://customers.example.dev/q/tok_synthetic',
  schedule_ids: ['sched-deposit'],
};

/** A summary "poisoned" with every field a leak could come from. */
const POISONED: QuoteSummary & Record<string, unknown> = {
  customer_ops_quote_id: 'q-0001',
  number: 'Q-2026-0001',
  version: 1,
  title: 'Order Pad for the apparel client',
  status: 'accepted',
  totals: {
    currency: 'USD',
    one_time_total_cents: 140000,
    milestone_total_cents: 290000,
    recurring_monthly_cents: 35000,
    one_time_plus_milestones_cents: 430000,
    year_one_illustration_cents: 850000,
    deposit_cents: 215000,
    tax_estimate_cents: 12000,
    hourly_rate_cents: 15000,
  },
  share_url: 'https://customers.example.dev/q/tok_synthetic',
  accepted_at: '2026-09-12T18:04:00Z',
  valid_until: '2026-10-12',
  pdf_url: 'https://customers.example.dev/pdf',
  federated: { project_ops_project_id: 'p1', status: 'partial' },
  internal_notes_md: 'margin is thin on M2',
  split_rule: { kind: 'percent_net', percent: 50 },
  costs: [{ label: 'hosting', amount_cents: 35000 }],
  accepted_by: { name: 'A. Person', email: 'a@example.test', ip: '10.0.0.1' },
  lines: [{ label: 'x' }],
};

describe('maskQuoteSummaryForClient', () => {
  it('emits exactly the whitelist — number, version, title, status, totals, share_url', () => {
    const masked = maskQuoteSummaryForClient(POISONED);
    expect(Object.keys(masked).sort()).toEqual([...CLIENT_QUOTE_SUMMARY_KEYS].sort());
    expect(Object.keys(masked.totals).sort()).toEqual(
      [
        'currency',
        'milestone_total_cents',
        'one_time_plus_milestones_cents',
        'one_time_total_cents',
        'recurring_monthly_cents',
      ].sort(),
    );
    expect(masked).toEqual({
      number: 'Q-2026-0001',
      version: 1,
      title: 'Order Pad for the apparel client',
      status: 'accepted',
      totals: {
        currency: 'USD',
        one_time_total_cents: 140000,
        milestone_total_cents: 290000,
        recurring_monthly_cents: 35000,
        one_time_plus_milestones_cents: 430000,
      },
      share_url: 'https://customers.example.dev/q/tok_synthetic',
    });
  });

  it('drops every internal / personal / rate field, even when present on the source', () => {
    const json = JSON.stringify(maskQuoteSummaryForClient(POISONED));
    for (const needle of [
      'internal',
      'split',
      'cost',
      'accepted_by',
      'a@example.test',
      '10.0.0.1',
      'hourly',
      'deposit',
      'tax_estimate',
      'year_one',
      'federated',
      'pdf_url',
      'customer_ops_quote_id',
      'lines',
      'valid_until',
      'accepted_at',
    ]) {
      expect(json).not.toContain(needle);
    }
  });

  it('the whitelist constant itself is the six agreed keys (a widening here is a review event)', () => {
    expect([...CLIENT_QUOTE_SUMMARY_KEYS].sort()).toEqual([
      'number',
      'share_url',
      'status',
      'title',
      'totals',
      'version',
    ]);
  });
});

describe('maskProjectQuoteRefForClient', () => {
  it('keeps number, version, share_url; drops the Customer-Ops id and schedule ids', () => {
    expect(maskProjectQuoteRefForClient(REF)).toEqual({
      number: 'Q-2026-0001',
      version: 1,
      share_url: 'https://customers.example.dev/q/tok_synthetic',
    });
  });
});

describe('readProjectQuoteRef / readCachedQuoteSummary / summaryFromCache', () => {
  it('returns null when the project did not come from a quote', () => {
    expect(readProjectQuoteRef(null)).toBeNull();
    expect(readProjectQuoteRef({})).toBeNull();
    expect(readProjectQuoteRef({ quote: { number: 'Q-1' } })).toBeNull(); // no id
    expect(readProjectQuoteRef({ customFields: { a: 1 } })).toBeNull();
  });

  it('reads the ids and tolerates a malformed schedule_ids', () => {
    expect(readProjectQuoteRef({ quote: { ...REF, schedule_ids: 'nope' } })).toEqual({
      ...REF,
      schedule_ids: [],
    });
    expect(readProjectQuoteRef({ quote: { ...REF, version: '2' } })!.version).toBe(2);
  });

  it('builds the staff view from ids + cache when Customer-Ops is unavailable', () => {
    const cached = readCachedQuoteSummary({
      quoteSummary: {
        title: 'Order Pad for the apparel client',
        currency: 'USD',
        status: 'accepted',
        totals: {
          one_time_total_cents: '140000',
          milestone_total_cents: 290000,
          recurring_monthly_cents: 35000,
        },
      },
    });
    const view = summaryFromCache(REF, cached);
    expect(view.number).toBe('Q-2026-0001');
    expect(view.title).toBe('Order Pad for the apparel client');
    expect(view.totals.one_time_plus_milestones_cents).toBe(430000);
    expect(view.totals.hourly_rate_cents).toBeNull();
    expect(view.share_url).toBe(REF.share_url);
  });

  it('degrades to zeros (never NaN) when there is no cache at all', () => {
    const view = summaryFromCache(REF, null);
    expect(view.totals).toEqual({
      currency: 'USD',
      one_time_total_cents: 0,
      milestone_total_cents: 0,
      recurring_monthly_cents: 0,
      one_time_plus_milestones_cents: 0,
      hourly_rate_cents: null,
    });
    expect(view.status).toBe('accepted');
  });
});

describe('normalizeQuoteSummary (tolerant reader of GET /api/quotes/:id/summary)', () => {
  it('accepts the nested { quote: { totals } } shape', () => {
    const s = normalizeQuoteSummary(
      {
        quote: {
          id: 'q-0001',
          number: 'Q-2026-0001',
          version: 1,
          title: 'T',
          status: 'accepted',
          currency: 'USD',
          totals: {
            one_time_total_cents: 100,
            milestone_total_cents: 200,
            recurring_monthly_cents: 30,
            year_one_illustration_cents: 660,
          },
          share_url: 'https://x.test/q/t',
          accepted_at: '2026-09-12T18:04:00Z',
          federated: { project_ops_project_id: 'p1' },
        },
      },
      REF,
    );
    expect(s.customer_ops_quote_id).toBe('q-0001');
    expect(s.totals.one_time_plus_milestones_cents).toBe(300);
    expect(s.totals.year_one_illustration_cents).toBe(660);
    expect(s.accepted_at).toBe('2026-09-12T18:04:00Z');
    expect(s.federated).toEqual({ project_ops_project_id: 'p1' });
  });

  it("accepts computeQuote's OWN spelling (one_time_cents / recurring{} / year_one_cents / hourly_primary)", () => {
    // The shape Customer-Ops' shared quote-model.ts produces (lane L2's
    // computeQuote), in case L1 serves the totals object verbatim.
    const s = normalizeQuoteSummary(
      {
        quote: {
          id: 'q-0001',
          number: 'Q-2026-0001',
          version: 2,
          title: 'T',
          status: 'accepted',
          totals: {
            currency: 'USD',
            one_time_cents: 140000,
            milestone_cents: 290000,
            recurring: {
              month_cents: 35000,
              quarter_cents: 30000,
              year_cents: 12000,
              monthly_equivalent_cents: 46000,
            },
            hourly_primary: {
              line_id: 'l9',
              label: 'Change work',
              rate_cents: 15000,
              minimum_hours: 2,
            },
            deposit_cents: 215000,
            year_one_cents: 850000,
          },
          share_url: 'https://x.test/q/t',
        },
      },
      REF,
    );
    expect(s.totals.one_time_total_cents).toBe(140000);
    expect(s.totals.milestone_total_cents).toBe(290000);
    expect(s.totals.one_time_plus_milestones_cents).toBe(430000);
    expect(s.totals.recurring_monthly_cents).toBe(46000);
    expect(s.totals.hourly_rate_cents).toBe(15000);
    expect(s.totals.year_one_illustration_cents).toBe(850000);
    expect(s.version).toBe(2);
  });

  it('blends a recurring block itself when no monthly equivalent is given (object or array)', () => {
    const asObject = normalizeQuoteSummary(
      { totals: { recurring: { month_cents: 35000, quarter_cents: 30000, year_cents: 12000 } } },
      REF,
    );
    expect(asObject.totals.recurring_monthly_cents).toBe(46000);

    const asArray = normalizeQuoteSummary(
      {
        totals: {
          recurring: [
            { interval: 'month', amount_cents: 35000 },
            { interval: 'quarter', amount_cents: 30000 },
            { interval: 'year', amount_cents: 12000 },
          ],
        },
      },
      REF,
    );
    expect(asArray.totals.recurring_monthly_cents).toBe(46000);
  });

  it('accepts a flat shape with numeric strings and falls back to the stored ref for missing ids', () => {
    const s = normalizeQuoteSummary(
      {
        title: 'T',
        status: 'sent',
        one_time_total_cents: '100',
        milestone_total_cents: '0',
        recurring_monthly_cents: 0,
      },
      REF,
    );
    expect(s.customer_ops_quote_id).toBe('q-0001');
    expect(s.number).toBe('Q-2026-0001');
    expect(s.version).toBe(1);
    expect(s.share_url).toBe(REF.share_url);
    expect(s.totals.one_time_total_cents).toBe(100);
    expect(s.totals.currency).toBe('USD');
    expect(s.totals.deposit_cents).toBeNull();
  });

  it('ignores unknown keys — nothing beyond the shape is surfaced', () => {
    const s = normalizeQuoteSummary({ quote: { ...POISONED } }, REF) as any;
    expect(s.internal_notes_md).toBeUndefined();
    expect(s.split_rule).toBeUndefined();
    expect(s.accepted_by).toBeUndefined();
    expect(s.costs).toBeUndefined();
  });
});
