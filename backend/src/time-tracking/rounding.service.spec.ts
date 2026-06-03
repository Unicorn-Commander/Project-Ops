import { RoundingMode } from '@prisma/client';
import { RoundingService } from './rounding.service';

describe('RoundingService', () => {
  const svc = new RoundingService();

  it('returns raw seconds when mode is NONE', () => {
    expect(svc.apply(1234, { mode: RoundingMode.NONE, incrementMinutes: 15 })).toBe(1234);
  });

  it('returns raw seconds when no config is given', () => {
    expect(svc.apply(1234)).toBe(1234);
    expect(svc.apply(1234, null)).toBe(1234);
  });

  it('returns raw seconds when increment is zero/absent even with a mode', () => {
    expect(svc.apply(1234, { mode: RoundingMode.UP, incrementMinutes: 0 })).toBe(1234);
  });

  it('floors negative/NaN raw to 0', () => {
    expect(svc.apply(-50, { mode: RoundingMode.UP, incrementMinutes: 6 })).toBe(0);
    expect(svc.apply(NaN as any, { mode: RoundingMode.NEAREST, incrementMinutes: 6 })).toBe(0);
  });

  describe('NEAREST (15 min = 900s)', () => {
    const cfg = { mode: RoundingMode.NEAREST, incrementMinutes: 15 };
    it('rounds 7 min down to 0', () => expect(svc.apply(7 * 60, cfg)).toBe(0));
    it('rounds 8 min up to 15 min', () => expect(svc.apply(8 * 60, cfg)).toBe(900));
    it('rounds 22 min to 15 min', () => expect(svc.apply(22 * 60, cfg)).toBe(900));
    it('rounds 23 min to 30 min', () => expect(svc.apply(23 * 60, cfg)).toBe(1800));
  });

  describe('UP (6 min = 360s)', () => {
    const cfg = { mode: RoundingMode.UP, incrementMinutes: 6 };
    it('rounds 1s up to 6 min', () => expect(svc.apply(1, cfg)).toBe(360));
    it('keeps an exact 6 min', () => expect(svc.apply(360, cfg)).toBe(360));
    it('rounds 6m1s up to 12 min', () => expect(svc.apply(361, cfg)).toBe(720));
  });

  describe('DOWN (15 min = 900s)', () => {
    const cfg = { mode: RoundingMode.DOWN, incrementMinutes: 15 };
    it('rounds 14m50s down to 0', () => expect(svc.apply(890, cfg)).toBe(0));
    it('rounds 15m1s down to 15 min', () => expect(svc.apply(901, cfg)).toBe(900));
  });
});
