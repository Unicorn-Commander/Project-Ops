import { HttpException, HttpStatus } from '@nestjs/common';
import {
  acceptLockKey,
  buildBillingNotes,
  buildQuoteRef,
  buildQuoteSummaryCache,
  centsToAmountString,
  federationError,
  looksLikePdf,
  mergeScheduleIds,
  normalizeCurrency,
  quotePdfObjectKey,
  recurringMonthlyCents,
  safeFileName,
  scheduleIdsChanged,
  selectTaskLines,
  sortTasksByQuotePosition,
} from './quote-federation.util';
import { QuoteAcceptedDto, QuoteLineDto } from './dto/quote-accepted.dto';

/**
 * Pure rules of the quote.accepted adapter (QUOTES-CONTRACT-v1 §3, Amendment
 * 01 A14/A16/A17). Fixtures are synthetic; the customer is "the apparel client".
 */
describe('quote-federation.util', () => {
  describe('normalizeCurrency (A17: 2-decimal currencies only)', () => {
    it('upper-cases a 2-decimal ISO code', () => {
      expect(normalizeCurrency('usd')).toBe('USD');
      expect(normalizeCurrency('EUR')).toBe('EUR');
    });
    it.each(['JPY', 'KRW', 'CLP', 'BHD', 'KWD', 'TND', 'CLF'])(
      'rejects %s with UNSUPPORTED_CURRENCY',
      (code) => {
        let err: HttpException | undefined;
        try {
          normalizeCurrency(code);
        } catch (e) {
          err = e as HttpException;
        }
        expect(err).toBeInstanceOf(HttpException);
        expect(err!.getStatus()).toBe(HttpStatus.BAD_REQUEST);
        expect((err!.getResponse() as any).code).toBe('UNSUPPORTED_CURRENCY');
        expect((err!.getResponse() as any).status).toBe('failed');
      },
    );
    it('rejects a non-ISO string', () => {
      expect(() => normalizeCurrency('dollars')).toThrow(HttpException);
      expect(() => normalizeCurrency('')).toThrow(HttpException);
    });
  });

  describe('centsToAmountString (never floats)', () => {
    it('renders integer cents as a two-decimal string', () => {
      expect(centsToAmountString(0)).toBe('0.00');
      expect(centsToAmountString(5)).toBe('0.05');
      expect(centsToAmountString(430000)).toBe('4300.00');
      expect(centsToAmountString(1234567)).toBe('12345.67');
      expect(centsToAmountString(15000)).toBe('150.00');
    });
    it('rejects negatives and non-integers', () => {
      expect(() => centsToAmountString(-1)).toThrow(HttpException);
      expect(() => centsToAmountString(10.5)).toThrow(HttpException);
    });
  });

  it('buildBillingNotes follows the contract wording exactly', () => {
    expect(buildBillingNotes('Q-2026-0001', 1, ' 50% on acceptance, 50% per milestone. ')).toBe(
      'Quote Q-2026-0001 v1: 50% on acceptance, 50% per milestone.',
    );
  });

  describe('selectTaskLines (A16)', () => {
    const line = (o: Partial<QuoteLineDto>): QuoteLineDto =>
      ({ kind: 'one_time', label: 'x', position: 0, ...o }) as QuoteLineDto;

    it('keeps accepted one_time + milestone lines only, in position order (stable)', () => {
      const out = selectTaskLines([
        line({ kind: 'milestone', label: 'M2', position: 3 }),
        line({ kind: 'recurring', label: 'Hosting', position: 5 }),
        line({ kind: 'one_time', label: 'Setup', position: 1 }),
        line({
          kind: 'option',
          label: 'Package: Pro',
          position: 2,
          option_group: 'package',
          selected: false,
        }),
        line({
          kind: 'option',
          label: 'Package: Starter',
          position: 2,
          option_group: 'package',
          selected: true,
        }),
        line({ kind: 'milestone', label: 'M1', position: 2 }),
        line({ kind: 'milestone', label: 'M1b (same position, later in input)', position: 2 }),
        line({ kind: 'hourly', label: 'Change work', position: 4 }),
        line({ kind: 'included', label: 'Training', position: 6 }),
        line({ kind: 'excluded', label: 'Hardware', position: 7 }),
      ]);
      expect(out.map((l) => l.label)).toEqual([
        'Setup',
        'M1',
        'M1b (same position, later in input)',
        'M2',
      ]);
    });

    it('never creates a task for an unselected option-group line, even when its kind is milestone', () => {
      const out = selectTaskLines([
        line({
          kind: 'milestone',
          label: 'Pro milestone',
          position: 1,
          option_group: 'package',
          selected: false,
        }),
        line({
          kind: 'milestone',
          label: 'Starter milestone',
          position: 2,
          option_group: 'package',
          selected: true,
        }),
      ]);
      expect(out.map((l) => l.label)).toEqual(['Starter milestone']);
    });
  });

  describe('schedule ids (A14: merged idempotently)', () => {
    it('unions in order, drops dupes/blanks, tolerates junk', () => {
      expect(mergeScheduleIds(['s1', 's2'], ['s2', 's3', '', 's1'])).toEqual(['s1', 's2', 's3']);
      expect(mergeScheduleIds(undefined, ['a'])).toEqual(['a']);
      expect(mergeScheduleIds('not-an-array', undefined)).toEqual([]);
      expect(mergeScheduleIds([1, null, 'x'] as any, ['x'])).toEqual(['x']);
    });
    it('scheduleIdsChanged is false for an identical replay', () => {
      expect(scheduleIdsChanged(['s1', 's2'], ['s1', 's2'])).toBe(false);
      expect(scheduleIdsChanged(['s1'], ['s1', 's2'])).toBe(true);
      expect(scheduleIdsChanged(undefined, [])).toBe(false);
    });
  });

  describe('recurringMonthlyCents (A4/A8 — month + quarter/3 + year/12, rounded)', () => {
    const b = (over: any) =>
      ({ one_time_total_cents: 0, milestone_total_cents: 0, schedule_text: '', ...over }) as any;

    it('blends the accepted recurring lines the way computeQuote does', () => {
      expect(
        recurringMonthlyCents(
          b({
            recurring: [
              { interval: 'month', amount_cents: 35000 },
              { interval: 'quarter', amount_cents: 30000 },
              { interval: 'year', amount_cents: 12000 },
            ],
          }),
        ),
      ).toBe(35000 + 10000 + 1000);
    });

    it('rounds the blend once, half up', () => {
      expect(
        recurringMonthlyCents(b({ recurring: [{ interval: 'year', amount_cents: 100 }] })),
      ).toBe(8); // 8.33
      expect(
        recurringMonthlyCents(b({ recurring: [{ interval: 'quarter', amount_cents: 100 }] })),
      ).toBe(33); // 33.33
      expect(
        recurringMonthlyCents(b({ recurring: [{ interval: 'quarter', amount_cents: 50 }] })),
      ).toBe(17); // 16.67
    });

    it('the array wins over a pre-blended scalar (one compute path)', () => {
      expect(
        recurringMonthlyCents(
          b({
            recurring: [{ interval: 'month', amount_cents: 35000 }],
            recurring_monthly_cents: 99999,
          }),
        ),
      ).toBe(35000);
    });

    it('falls back to the scalar when no lines are sent, and to 0 when neither is', () => {
      expect(recurringMonthlyCents(b({ recurring_monthly_cents: 35000 }))).toBe(35000);
      expect(recurringMonthlyCents(b({ recurring: [], recurring_monthly_cents: 35000 }))).toBe(
        35000,
      );
      expect(recurringMonthlyCents(b({}))).toBe(0);
    });
  });

  describe('metadata builders', () => {
    const dto = {
      customer_ops_quote_id: 'q-0001',
      number: 'Q-2026-0001',
      version: 1,
      title: 'Order Pad for the apparel client',
      share_url: 'https://customers.example.dev/q/tok_synthetic',
      billing: {
        one_time_total_cents: 140000,
        milestone_total_cents: 290000,
        deposit_cents: 215000,
        recurring: [{ interval: 'month', amount_cents: 35000, label: 'Managed hosting' }],
        hourly_rate_cents: 15000,
        schedule_text: 'x',
      },
    } as QuoteAcceptedDto;

    it('metadata.quote holds ids + schedule_ids only', () => {
      expect(buildQuoteRef(dto, ['s1'])).toEqual({
        customer_ops_quote_id: 'q-0001',
        number: 'Q-2026-0001',
        version: 1,
        share_url: 'https://customers.example.dev/q/tok_synthetic',
        schedule_ids: ['s1'],
      });
    });

    it('metadata.quoteSummary is the client-whitelisted cache (no rate, no schedule text)', () => {
      const cache = buildQuoteSummaryCache(dto, 'USD');
      expect(cache).toEqual({
        title: 'Order Pad for the apparel client',
        currency: 'USD',
        status: 'accepted',
        totals: {
          one_time_total_cents: 140000,
          milestone_total_cents: 290000,
          recurring_monthly_cents: 35000,
        },
      });
      // The deposit is Accounting-Ops' paper (§3); Project-Ops accepts it on the
      // wire and keeps no copy.
      expect(JSON.stringify(cache)).not.toContain('deposit');
      expect(JSON.stringify(cache)).not.toContain('hourly');
      expect(JSON.stringify(cache)).not.toContain('schedule');
    });
  });

  describe('object keys + lock keys', () => {
    it('quotePdfObjectKey is deterministic per (workspace, quote, version, file)', () => {
      const a = quotePdfObjectKey('ws-1', 'q-0001', 1, 'Q-2026-0001-v1.pdf');
      expect(a).toBe('quotes/ws-1/q-0001/v1/Q-2026-0001-v1.pdf');
      expect(quotePdfObjectKey('ws-1', 'q-0001', 1, 'Q-2026-0001-v1.pdf')).toBe(a);
      expect(quotePdfObjectKey('ws-1', 'q-0001', 2, 'Q-2026-0001-v1.pdf')).not.toBe(a);
    });
    it('safeFileName strips paths and odd characters and enforces .pdf', () => {
      expect(safeFileName('../../etc/passwd')).toBe('passwd.pdf');
      expect(safeFileName('Quote #1 (final).PDF')).toBe('Quote _1 _final_.PDF');
      expect(safeFileName('')).toBe('quote.pdf');
    });
    it('acceptLockKey is namespaced and version-specific', () => {
      expect(acceptLockKey('ws-1', 'q-0001', 1)).toBe('project-ops:quote-accept:ws-1:q-0001:1');
      expect(acceptLockKey('ws-1', 'q-0001', 2)).not.toBe(acceptLockKey('ws-1', 'q-0001', 1));
    });
  });

  it('sortTasksByQuotePosition orders by recorded position, then creation', () => {
    const t = (id: string, position: number | undefined, ms: number) => ({
      id,
      metadata: position === undefined ? {} : { quote: { position } },
      createdAt: new Date(ms),
    });
    expect(
      sortTasksByQuotePosition([
        t('c', 3, 1),
        t('a', 1, 3),
        t('z', undefined, 0),
        t('b', 2, 2),
      ]).map((x) => x.id),
    ).toEqual(['a', 'b', 'c', 'z']);
  });

  it('looksLikePdf checks the %PDF- magic', () => {
    expect(looksLikePdf(Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(looksLikePdf(Buffer.from('<html>'))).toBe(false);
    expect(looksLikePdf(Buffer.alloc(0))).toBe(false);
  });

  it('federationError carries the A7 envelope', () => {
    const err = federationError(HttpStatus.BAD_GATEWAY, 'PDF_FETCH_FAILED', 'nope');
    expect(err.getStatus()).toBe(502);
    expect(err.getResponse()).toEqual({
      status: 'failed',
      code: 'PDF_FETCH_FAILED',
      reason: 'nope',
    });
  });
});
