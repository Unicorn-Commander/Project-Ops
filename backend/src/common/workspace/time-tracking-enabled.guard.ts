import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timeTrackingEnabled } from './feature-flags';

/**
 * Gates the time-tracking REST surface behind TIME_TRACKING_ENABLED (default
 * ON). When disabled, endpoints behave as if they don't exist (404), so the
 * feature can land dark on a node without exposing half-built surfaces.
 */
@Injectable()
export class TimeTrackingEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(): boolean {
    if (!timeTrackingEnabled((k) => this.config.get<string>(k))) {
      throw new NotFoundException('Time tracking is not enabled');
    }
    return true;
  }
}
