/**
 * GET /api/v1/version — unauthenticated, returns the build identity
 * of this running backend so a quick `curl` confirms which release
 * actually shipped vs. what the deploy thinks shipped.
 *
 * Build args (`SENTRY_RELEASE`, `BUILD_COMMIT`, `BUILD_DATE`) are
 * optional — when unset we fall back to the package.json version.
 * Throttling is skipped to match the rest of the health surface.
 */

import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

const PACKAGE_VERSION =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('../../package.json') as { version: string }).version;

@ApiTags('health')
@SkipThrottle({ short: true, long: true })
@Controller('version')
export class VersionController {
  @Get()
  @ApiOperation({
    summary: 'Build identity (version, commit, build timestamp)',
  })
  get() {
    return {
      service: 'project-ops-backend',
      version: PACKAGE_VERSION,
      release: process.env.SENTRY_RELEASE || `project-ops-backend@${PACKAGE_VERSION}`,
      commit: process.env.BUILD_COMMIT || null,
      builtAt: process.env.BUILD_DATE || null,
      environment: process.env.NODE_ENV || 'production',
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
