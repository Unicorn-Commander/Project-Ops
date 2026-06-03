import { Injectable } from '@nestjs/common';
import { RoundingMode } from '@prisma/client';

export interface RoundingConfig {
  incrementMinutes?: number | null;
  mode?: RoundingMode | null;
}

/**
 * Deterministic time rounding. Pure and fully unit-tested.
 *
 * Raw elapsed seconds are stored verbatim on the entry; this computes the
 * *billable* seconds after applying the tenant/project rounding policy. We
 * store both (durationSeconds = raw, roundingAppliedSeconds = result here).
 */
@Injectable()
export class RoundingService {
  /**
   * @param rawSeconds elapsed seconds (>= 0)
   * @returns billable seconds after rounding to the configured increment
   */
  apply(rawSeconds: number, config?: RoundingConfig | null): number {
    const raw = Math.max(0, Math.floor(rawSeconds || 0));

    const mode = config?.mode ?? RoundingMode.NONE;
    const incrementMinutes = config?.incrementMinutes ?? 0;
    const incrementSeconds = Math.floor((incrementMinutes || 0) * 60);

    if (mode === RoundingMode.NONE || incrementSeconds <= 0) {
      return raw;
    }

    const units = raw / incrementSeconds;
    switch (mode) {
      case RoundingMode.NEAREST:
        return Math.round(units) * incrementSeconds;
      case RoundingMode.UP:
        return Math.ceil(units) * incrementSeconds;
      case RoundingMode.DOWN:
        return Math.floor(units) * incrementSeconds;
      default:
        return raw;
    }
  }
}
