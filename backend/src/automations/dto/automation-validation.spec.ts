import {
  IsAutomationActionArray,
  IsAutomationConditionArray,
  validateActionParams,
} from './automation-validation';

describe('validateActionParams', () => {
  it('assign_task requires userId', () => {
    expect(validateActionParams('assign_task', { userId: 'u1' })).toBeNull();
    expect(validateActionParams('assign_task', {})).toMatch(/userId/);
  });

  it('set_status requires a valid TaskStatus', () => {
    expect(validateActionParams('set_status', { status: 'COMPLETED' })).toBeNull();
    expect(validateActionParams('set_status', { status: 'NOPE' })).toMatch(/must be one of/);
    expect(validateActionParams('set_status', {})).toMatch(/status/);
  });

  it('add_comment requires text', () => {
    expect(validateActionParams('add_comment', { text: 'hi' })).toBeNull();
    expect(validateActionParams('add_comment', { text: '' })).toMatch(/text/);
  });

  it('create_task requires title and validates optional priority', () => {
    expect(validateActionParams('create_task', { title: 'T' })).toBeNull();
    expect(validateActionParams('create_task', { title: 'T', priority: 'HIGH' })).toBeNull();
    expect(validateActionParams('create_task', { title: 'T', priority: 'X' })).toMatch(/priority/);
    expect(validateActionParams('create_task', {})).toMatch(/title/);
  });

  it('notify requires userId and validates optional message type', () => {
    expect(validateActionParams('notify', { userId: 'u1' })).toBeNull();
    expect(validateActionParams('notify', { userId: 'u1', message: 'hey' })).toBeNull();
    expect(validateActionParams('notify', { userId: 'u1', message: 5 as any })).toMatch(/message/);
    expect(validateActionParams('notify', {})).toMatch(/userId/);
  });

  it('rejects a missing params object', () => {
    expect(validateActionParams('notify', null)).toMatch(/params object/);
  });
});

describe('IsAutomationActionArray', () => {
  const v = new IsAutomationActionArray();

  it('accepts a well-formed action array', () => {
    expect(
      v.validate([
        { type: 'assign_task', params: { userId: 'u1' } },
        { type: 'set_status', params: { status: 'IN_PROGRESS' } },
      ]),
    ).toBe(true);
  });

  it('rejects an empty array', () => {
    expect(v.validate([])).toBe(false);
    expect(v.defaultMessage()).toMatch(/non-empty/);
  });

  it('rejects an unknown action type', () => {
    expect(v.validate([{ type: 'delete_everything', params: {} }])).toBe(false);
    expect(v.defaultMessage()).toMatch(/type must be one of/);
  });

  it('rejects bad params with an indexed message', () => {
    expect(v.validate([{ type: 'set_status', params: { status: 'BOGUS' } }])).toBe(false);
    expect(v.defaultMessage()).toMatch(/actions\[0\]/);
  });
});

describe('IsAutomationConditionArray', () => {
  const v = new IsAutomationConditionArray();

  it('accepts undefined (optional) and a valid array', () => {
    expect(v.validate(undefined)).toBe(true);
    expect(v.validate([{ field: 'priority', op: 'eq', value: 'URGENT' }])).toBe(true);
  });

  it('rejects a bad op / empty field / missing value', () => {
    expect(v.validate([{ field: 'p', op: 'bogus', value: 1 }])).toBe(false);
    expect(v.validate([{ field: '', op: 'eq', value: 1 }])).toBe(false);
    expect(v.validate([{ field: 'p', op: 'eq' }])).toBe(false);
  });
});
