import {
  parseRecurrenceRule,
  advanceByRecurrence,
  nextOccurrenceAfter,
} from './recurrence.util';

describe('parseRecurrenceRule', () => {
  it('parses FREQ + INTERVAL (case-insensitive, RRULE: prefix tolerated)', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
    });
    expect(parseRecurrenceRule('rrule:freq=daily')).toEqual({
      freq: 'DAILY',
      interval: 1,
    });
  });

  it('defaults INTERVAL to 1 and ignores unknown parts', () => {
    expect(parseRecurrenceRule('FREQ=MONTHLY;BYDAY=MO;COUNT=5')).toEqual({
      freq: 'MONTHLY',
      interval: 1,
    });
  });

  it('falls back to interval 1 on a malformed INTERVAL', () => {
    expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=0')).toEqual({
      freq: 'DAILY',
      interval: 1,
    });
    expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=abc')).toEqual({
      freq: 'DAILY',
      interval: 1,
    });
  });

  it('returns null for empty, missing FREQ, or unsupported FREQ', () => {
    expect(parseRecurrenceRule('')).toBeNull();
    expect(parseRecurrenceRule(null)).toBeNull();
    expect(parseRecurrenceRule(undefined)).toBeNull();
    expect(parseRecurrenceRule('INTERVAL=2')).toBeNull();
    expect(parseRecurrenceRule('FREQ=YEARLY')).toBeNull();
    expect(parseRecurrenceRule('FREQ=HOURLY;INTERVAL=3')).toBeNull();
  });
});

describe('advanceByRecurrence', () => {
  it('adds days for DAILY (preserving time-of-day)', () => {
    const from = new Date('2026-01-10T09:30:00.000Z');
    expect(advanceByRecurrence(from, { freq: 'DAILY', interval: 3 }).toISOString()).toBe(
      '2026-01-13T09:30:00.000Z',
    );
  });

  it('adds weeks for WEEKLY', () => {
    const from = new Date('2026-01-10T09:30:00.000Z');
    expect(advanceByRecurrence(from, { freq: 'WEEKLY', interval: 2 }).toISOString()).toBe(
      '2026-01-24T09:30:00.000Z',
    );
  });

  it('adds months for MONTHLY', () => {
    const from = new Date('2026-01-15T00:00:00.000Z');
    expect(advanceByRecurrence(from, { freq: 'MONTHLY', interval: 1 }).toISOString()).toBe(
      '2026-02-15T00:00:00.000Z',
    );
  });

  it('clamps MONTHLY to the last day when the target month is shorter', () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year), NOT Mar 3.
    const from = new Date('2026-01-31T00:00:00.000Z');
    expect(advanceByRecurrence(from, { freq: 'MONTHLY', interval: 1 }).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
  });

  it('clamps MONTHLY to Feb 29 in a leap year', () => {
    const from = new Date('2028-01-31T00:00:00.000Z');
    expect(advanceByRecurrence(from, { freq: 'MONTHLY', interval: 1 }).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });
});

describe('nextOccurrenceAfter', () => {
  it('returns the first cadence step strictly after the cursor', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z');
    // weekly: the first occurrence > Jan 10 is Jan 15 (Jan 1, 8, 15...).
    const next = nextOccurrenceAfter(
      'FREQ=WEEKLY;INTERVAL=1',
      anchor,
      new Date('2026-01-10T00:00:00.000Z'),
    );
    expect(next?.toISOString()).toBe('2026-01-15T00:00:00.000Z');
  });

  it('returns the anchor itself when it is already after the cursor', () => {
    const anchor = new Date('2026-06-01T00:00:00.000Z');
    const next = nextOccurrenceAfter(
      'FREQ=DAILY',
      anchor,
      new Date('2026-05-01T00:00:00.000Z'),
    );
    expect(next?.toISOString()).toBe(anchor.toISOString());
  });

  it('advances exactly one step when cursor == anchor', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z');
    const next = nextOccurrenceAfter('FREQ=DAILY;INTERVAL=1', anchor, anchor);
    expect(next?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('returns null for an unusable rule', () => {
    const anchor = new Date('2026-01-01T00:00:00.000Z');
    expect(nextOccurrenceAfter('FREQ=YEARLY', anchor, anchor)).toBeNull();
    expect(nextOccurrenceAfter('', anchor, anchor)).toBeNull();
  });
});
