import { parseRecurrenceRule, advanceByRecurrence, nextOccurrenceAfter } from './recurrence.util';

describe('parseRecurrenceRule', () => {
  it('parses FREQ + INTERVAL (with/without RRULE: prefix, any case/order)', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;INTERVAL=2')).toEqual({
      freq: 'WEEKLY',
      interval: 2,
    });
    expect(parseRecurrenceRule('RRULE:freq=daily')).toEqual({ freq: 'DAILY', interval: 1 });
    expect(parseRecurrenceRule('INTERVAL=3;FREQ=MONTHLY')).toEqual({
      freq: 'MONTHLY',
      interval: 3,
    });
  });

  it('defaults INTERVAL to 1 when absent or malformed', () => {
    expect(parseRecurrenceRule('FREQ=DAILY')).toEqual({ freq: 'DAILY', interval: 1 });
    expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=0')).toEqual({ freq: 'DAILY', interval: 1 });
    expect(parseRecurrenceRule('FREQ=DAILY;INTERVAL=abc')).toEqual({ freq: 'DAILY', interval: 1 });
  });

  it('ignores unsupported parts but keeps a valid FREQ/INTERVAL', () => {
    expect(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10')).toEqual({
      freq: 'WEEKLY',
      interval: 1,
    });
  });

  it('returns null for empty / no-FREQ / unsupported FREQ', () => {
    expect(parseRecurrenceRule('')).toBeNull();
    expect(parseRecurrenceRule(null)).toBeNull();
    expect(parseRecurrenceRule('INTERVAL=2')).toBeNull();
    expect(parseRecurrenceRule('FREQ=YEARLY')).toBeNull();
  });
});

describe('advanceByRecurrence', () => {
  it('advances DAILY/WEEKLY by interval (preserving time-of-day)', () => {
    const base = new Date('2026-01-01T09:00:00Z');
    expect(advanceByRecurrence(base, { freq: 'DAILY', interval: 1 }).toISOString()).toBe(
      '2026-01-02T09:00:00.000Z',
    );
    expect(advanceByRecurrence(base, { freq: 'WEEKLY', interval: 2 }).toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    );
  });

  it('advances MONTHLY and clamps to month length (Jan-31 + 1mo -> Feb-28)', () => {
    const jan31 = new Date('2026-01-31T05:00:00Z');
    expect(advanceByRecurrence(jan31, { freq: 'MONTHLY', interval: 1 }).toISOString()).toBe(
      '2026-02-28T05:00:00.000Z',
    );
  });

  it('does not mutate the input', () => {
    const base = new Date('2026-01-01T00:00:00Z');
    advanceByRecurrence(base, { freq: 'DAILY', interval: 5 });
    expect(base.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps a 09:00 New York daily occurrence at 09:00 after fall-back', () => {
    const anchor = new Date('2026-10-31T13:00:00.000Z');

    expect(advanceByRecurrence(anchor, { freq: 'DAILY', interval: 1 }).toISOString()).toBe(
      '2026-11-01T14:00:00.000Z',
    );
  });
});

describe('nextOccurrenceAfter', () => {
  it('returns null for an unusable rule', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    expect(nextOccurrenceAfter('FREQ=YEARLY', d, d)).toBeNull();
  });

  it('returns the anchor when it is already after the cursor', () => {
    const anchor = new Date('2026-02-01T00:00:00Z');
    const after = new Date('2026-01-01T00:00:00Z');
    expect(nextOccurrenceAfter('FREQ=WEEKLY', anchor, after)!.toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('walks forward in cadence steps to the first occurrence past the cursor', () => {
    const anchor = new Date('2026-01-01T00:00:00Z');
    const after = new Date('2026-01-01T00:00:00Z'); // equal → must step
    expect(nextOccurrenceAfter('FREQ=WEEKLY;INTERVAL=1', anchor, after)!.toISOString()).toBe(
      '2026-01-08T00:00:00.000Z',
    );
  });

  it('catches up a stale anchor to a future occurrence on cadence', () => {
    const anchor = new Date('2026-01-01T00:00:00Z');
    const after = new Date('2026-02-15T00:00:00Z');
    const out = nextOccurrenceAfter('FREQ=WEEKLY', anchor, after)!;
    expect(out.getTime()).toBeGreaterThan(after.getTime());
    expect(((out.getTime() - anchor.getTime()) / 86400000) % 7).toBe(0);
  });
});
