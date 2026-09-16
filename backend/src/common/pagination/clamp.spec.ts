import { clampLimit, clampOffset, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './clamp';

describe('clampLimit', () => {
  it('defaults when limit is absent', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(null)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('honors a custom fallback when absent', () => {
    expect(clampLimit(undefined, 50)).toBe(50);
  });

  it('passes through a valid in-range value', () => {
    expect(clampLimit(25)).toBe(25);
  });

  it('caps at the max', () => {
    expect(clampLimit(1000)).toBe(MAX_PAGE_SIZE);
    expect(clampLimit(101)).toBe(MAX_PAGE_SIZE);
  });

  it('rejects non-positive / non-finite values via the fallback', () => {
    expect(clampLimit(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(-5)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampLimit(Infinity)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('floors fractional values', () => {
    expect(clampLimit(10.9)).toBe(10);
  });

  it('never returns below 1 even with a degenerate fallback/max', () => {
    expect(clampLimit(undefined, 0)).toBe(1);
    expect(clampLimit(undefined, -10)).toBe(1);
  });
});

describe('clampOffset', () => {
  it('defaults to 0 when absent or invalid', () => {
    expect(clampOffset(undefined)).toBe(0);
    expect(clampOffset(null)).toBe(0);
    expect(clampOffset(-1)).toBe(0);
    expect(clampOffset(Number.NaN)).toBe(0);
  });

  it('passes through a valid offset and floors fractions', () => {
    expect(clampOffset(50)).toBe(50);
    expect(clampOffset(12.7)).toBe(12);
  });
});
