import {
  BUSINESS_TIME_ZONE,
  advanceBusinessWallTime,
  businessMonthBoundsUtc,
  businessWeekBoundsUtc,
  dateOnlyToUtcDate,
  formatStoredDateOnly,
  overdueDateCutoffUtc,
  parseBusinessDateInput,
  serializeDateOnlyFields,
} from './business-time';

describe('business-time', () => {
  it('keeps a stored date-only value on its own calendar date', () => {
    const stored = dateOnlyToUtcDate('2026-10-16');

    expect(BUSINESS_TIME_ZONE).toBe('America/New_York');
    expect(stored.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(formatStoredDateOnly(stored)).toBe('2026-10-16');
  });

  it('serializes date-only fields for MCP without viewer-timezone shifts', () => {
    expect(
      serializeDateOnlyFields({
        dueDate: new Date('2026-10-16T00:00:00.000Z'),
        billingDate: new Date('2026-10-16T00:00:00.000Z'),
        paymentDueDate: new Date('2026-10-16T00:00:00.000Z'),
        paymentReceivedDate: new Date('2026-11-02T01:00:00.000Z'),
      }),
    ).toEqual({
      dueDate: '2026-10-16',
      billingDate: '2026-10-16',
      paymentDueDate: '2026-10-16',
      paymentReceivedDate: '2026-11-01',
    });
  });

  it('interprets a bare API date as midnight in the business zone', () => {
    expect(parseBusinessDateInput('2026-10-19').toISOString()).toBe('2026-10-19T04:00:00.000Z');
  });

  it('resolves the current week from the business calendar', () => {
    const bounds = businessWeekBoundsUtc(new Date('2026-10-19T01:30:00.000Z'));

    expect(bounds.from.toISOString()).toBe('2026-10-12T04:00:00.000Z');
    expect(bounds.to.toISOString()).toBe('2026-10-19T03:59:59.999Z');
  });

  it('uses business-month boundaries across the fall-back transition', () => {
    const bounds = businessMonthBoundsUtc(2026, 10);

    expect(bounds.from.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(bounds.to.toISOString()).toBe('2026-11-01T03:59:59.999Z');
  });

  it('does not mark today due dates overdue before the local business day ends', () => {
    expect(overdueDateCutoffUtc(new Date('2026-10-16T12:00:00.000Z')).toISOString()).toBe(
      '2026-10-16T00:00:00.000Z',
    );
    expect(overdueDateCutoffUtc(new Date('2026-10-17T04:01:00.000Z')).toISOString()).toBe(
      '2026-10-17T00:00:00.000Z',
    );
  });

  it('advances a recurring wall-clock time across the DST fall-back', () => {
    const next = advanceBusinessWallTime(new Date('2026-10-31T13:00:00.000Z'), 'DAILY', 1);

    expect(next.toISOString()).toBe('2026-11-01T14:00:00.000Z');
  });

  it('keeps stored date-only recurrence dates as calendar dates across DST', () => {
    const next = advanceBusinessWallTime(new Date('2026-11-01T00:00:00.000Z'), 'DAILY', 1);

    expect(next.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});
