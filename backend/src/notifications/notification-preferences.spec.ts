import {
  DEFAULT_PREFERENCES,
  EVENT_TO_PREFERENCE_KEY,
  PreferenceKey,
  applyPreferencePatch,
  mergePreferences,
  shouldEmail,
} from './notification-preferences';

/**
 * Pure-logic tests for the email-notification preference model: defaults, the
 * merge over a null/partial/garbage stored column, the PATCH apply, and the
 * send gate. No Nest / DB.
 */

describe('mergePreferences (defaults + merge)', () => {
  it('null column => full defaults (email ON; high-signal events ON, noisy OFF)', () => {
    const p = mergePreferences(null);
    expect(p).toEqual(DEFAULT_PREFERENCES);
    expect(p.email).toBe(true);
    expect(p.events[PreferenceKey.TASK_ASSIGNED]).toBe(true);
    expect(p.events[PreferenceKey.MENTION]).toBe(true);
    expect(p.events[PreferenceKey.APPROVAL_REQUESTED]).toBe(true);
    expect(p.events[PreferenceKey.PROJECT_STATUS_CHANGED]).toBe(false);
    expect(p.events[PreferenceKey.TASK_STATUS_CHANGED]).toBe(false);
  });

  it('returns a COPY (mutating the result never mutates DEFAULT_PREFERENCES)', () => {
    const p = mergePreferences(null);
    p.email = false;
    p.events[PreferenceKey.TASK_ASSIGNED] = false;
    expect(DEFAULT_PREFERENCES.email).toBe(true);
    expect(DEFAULT_PREFERENCES.events[PreferenceKey.TASK_ASSIGNED]).toBe(true);
  });

  it('partial stored map overlays defaults; absent keys keep their default', () => {
    const p = mergePreferences({
      email: false,
      events: { [PreferenceKey.PROJECT_STATUS_CHANGED]: true },
    });
    expect(p.email).toBe(false);
    expect(p.events[PreferenceKey.PROJECT_STATUS_CHANGED]).toBe(true); // overlaid
    expect(p.events[PreferenceKey.TASK_ASSIGNED]).toBe(true); // default kept
  });

  it('drops unknown keys and ignores non-boolean values', () => {
    const p = mergePreferences({
      email: 'yes', // not a boolean -> default true kept
      events: { bogus_key: true, [PreferenceKey.MENTION]: 'nope' },
    });
    expect(p.email).toBe(true);
    expect((p.events as any).bogus_key).toBeUndefined();
    expect(p.events[PreferenceKey.MENTION]).toBe(true); // non-boolean ignored, default kept
  });

  it('garbage (array / string / number) => full defaults', () => {
    expect(mergePreferences([1, 2, 3])).toEqual(DEFAULT_PREFERENCES);
    expect(mergePreferences('nope')).toEqual(DEFAULT_PREFERENCES);
    expect(mergePreferences(42)).toEqual(DEFAULT_PREFERENCES);
  });

  it('preserves a well-formed reserved digest block (forward-compat, not consumed)', () => {
    const p = mergePreferences({ digest: { enabled: true, frequency: 'weekly' } });
    expect(p.digest).toEqual({ enabled: true, frequency: 'weekly' });
    const bad = mergePreferences({ digest: { enabled: 'x', frequency: 'hourly' } });
    expect(bad.digest).toBeUndefined();
  });
});

describe('applyPreferencePatch (partial update)', () => {
  it('replaces email when present, leaves it when absent', () => {
    const current = mergePreferences(null);
    expect(applyPreferencePatch(current, { email: false }).email).toBe(false);
    expect(applyPreferencePatch(current, {}).email).toBe(true);
  });

  it('shallow-merges events key-by-key (omitted keys untouched)', () => {
    const current = mergePreferences(null);
    const next = applyPreferencePatch(current, {
      events: { [PreferenceKey.PROJECT_STATUS_CHANGED]: true },
    });
    expect(next.events[PreferenceKey.PROJECT_STATUS_CHANGED]).toBe(true); // changed
    expect(next.events[PreferenceKey.TASK_ASSIGNED]).toBe(true); // untouched
    expect(next.events[PreferenceKey.TASK_COMPLETED]).toBe(false); // untouched
  });

  it('can turn a default-ON key OFF', () => {
    const current = mergePreferences(null);
    const next = applyPreferencePatch(current, {
      events: { [PreferenceKey.TASK_ASSIGNED]: false },
    });
    expect(next.events[PreferenceKey.TASK_ASSIGNED]).toBe(false);
  });

  it('re-normalizes: stray keys slipped into the patch are dropped', () => {
    const current = mergePreferences(null);
    const next = applyPreferencePatch(current, {
      events: { evil: true } as any,
    });
    expect((next.events as any).evil).toBeUndefined();
  });
});

describe('shouldEmail (the send gate)', () => {
  const prefs = mergePreferences(null); // defaults: email ON, assignment ON, status OFF

  it('sends when master ON + event key ON + recipient != actor', () => {
    expect(
      shouldEmail({
        eventName: 'task.assigned',
        prefs,
        recipientUserId: 'u-1',
        actorUserId: 'u-2',
      }),
    ).toBe(true);
  });

  it('does NOT send when the recipient IS the actor (own action)', () => {
    expect(
      shouldEmail({
        eventName: 'task.assigned',
        prefs,
        recipientUserId: 'u-1',
        actorUserId: 'u-1',
      }),
    ).toBe(false);
  });

  it('does NOT send when the master email toggle is off', () => {
    const off = applyPreferencePatch(prefs, { email: false });
    expect(
      shouldEmail({
        eventName: 'task.assigned',
        prefs: off,
        recipientUserId: 'u-1',
        actorUserId: 'u-2',
      }),
    ).toBe(false);
  });

  it('does NOT send when this specific event key is off (default-OFF noisy event)', () => {
    expect(
      shouldEmail({
        eventName: 'task.status_changed',
        prefs,
        recipientUserId: 'u-1',
        actorUserId: 'u-2',
      }),
    ).toBe(false);
  });

  it('sends a default-OFF event once the user opts in', () => {
    const opted = applyPreferencePatch(prefs, {
      events: { [PreferenceKey.PROJECT_STATUS_CHANGED]: true },
    });
    expect(
      shouldEmail({
        eventName: 'project.status_changed',
        prefs: opted,
        recipientUserId: 'u-1',
        actorUserId: 'u-2',
      }),
    ).toBe(true);
  });

  it('does NOT send for an unmapped event name', () => {
    expect(
      shouldEmail({
        eventName: 'something.unmapped',
        prefs,
        recipientUserId: 'u-1',
        actorUserId: 'u-2',
      }),
    ).toBe(false);
  });

  it('maps the comment event to MENTION and the timesheet event to APPROVAL_REQUESTED', () => {
    expect(EVENT_TO_PREFERENCE_KEY['task.comment.created']).toBe(PreferenceKey.MENTION);
    expect(EVENT_TO_PREFERENCE_KEY['timesheet.submitted']).toBe(PreferenceKey.APPROVAL_REQUESTED);
    // Both default ON -> both emailable to a non-actor under defaults.
    expect(
      shouldEmail({
        eventName: 'task.comment.created',
        prefs,
        recipientUserId: 'a',
        actorUserId: 'b',
      }),
    ).toBe(true);
    expect(
      shouldEmail({
        eventName: 'timesheet.submitted',
        prefs,
        recipientUserId: 'a',
        actorUserId: 'b',
      }),
    ).toBe(true);
  });
});
