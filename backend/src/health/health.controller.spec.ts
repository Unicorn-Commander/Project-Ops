/**
 * Unit tests for the health controller's memory guardrails.
 *
 * Regression cover for the P-00085 flapping bug: the memory_heap / memory_rss
 * thresholds were once hardcoded at 150 MB / 300 MB — below the backend's
 * ordinary working set — so /api/v1/health reported `status:error` on a
 * healthy service. The values are now the realistic 1 GiB / 2 GiB defaults and
 * are env-tunable, and must never fall through to a missing/zero/negative
 * limit.
 *
 * These tests are hermetic: every indicator is a mock, so no DB or HTTP
 * dependency is touched.
 */
import { ConfigService } from '@nestjs/config';
import { HealthCheckService } from '@nestjs/terminus';
import { HealthController, resolveMemoryLimitBytes } from './health.controller';

const MB = 1024 * 1024;

interface Mocks {
  controller: HealthController;
  health: { check: jest.Mock };
  memory: { checkHeap: jest.Mock; checkRSS: jest.Mock };
  prismaHealth: { isHealthy: jest.Mock };
}

function buildController(configValues: Record<string, string | number>): Mocks {
  const health = { check: jest.fn().mockResolvedValue({ status: 'ok' }) };
  const memory = {
    checkHeap: jest.fn().mockReturnValue({ memory_heap: { status: 'up' } }),
    checkRSS: jest.fn().mockReturnValue({ memory_rss: { status: 'up' } }),
  };
  const prismaHealth = {
    isHealthy: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
  };
  const config = new ConfigService(configValues);

  const controller = new HealthController(
    health as unknown as HealthCheckService,
    {} as never,
    memory as never,
    {} as never,
    prismaHealth as never,
    {} as never,
    config,
  );

  return { controller, health, memory, prismaHealth };
}

/** Run the registered checks and return the first indicator result. */
async function runChecks(mocks: Mocks): Promise<void> {
  await mocks.controller.check();
  const checks: Array<() => unknown> = mocks.health.check.mock.calls[0][0];
  for (const check of checks) {
    await check();
  }
}

describe('resolveMemoryLimitBytes', () => {
  it('returns the default when the key is absent', () => {
    const config = new ConfigService({});
    expect(resolveMemoryLimitBytes(config, 'HEALTH_MEMORY_HEAP_MB', 1024)).toBe(1024 * MB);
  });

  it('honours an explicit numeric value', () => {
    const config = new ConfigService({ HEALTH_MEMORY_HEAP_MB: 2048 });
    expect(resolveMemoryLimitBytes(config, 'HEALTH_MEMORY_HEAP_MB', 1024)).toBe(2048 * MB);
  });

  it('parses a numeric string value (env vars arrive as strings)', () => {
    const config = new ConfigService({ HEALTH_MEMORY_RSS_MB: '512' });
    expect(resolveMemoryLimitBytes(config, 'HEALTH_MEMORY_RSS_MB', 1024)).toBe(512 * MB);
  });

  it.each(['not-a-number', '0', '-5', '', '   ', '0x10', '1e30', '12.5', 'true'])(
    'falls back to the safe default for invalid value %p',
    (value) => {
      const config = new ConfigService({ HEALTH_MEMORY_HEAP_MB: value });
      expect(resolveMemoryLimitBytes(config, 'HEALTH_MEMORY_HEAP_MB', 1024)).toBe(1024 * MB);
    },
  );
});

describe('HealthController.check', () => {
  it('uses 1 GiB heap / 2 GiB RSS defaults', async () => {
    const mocks = buildController({});
    await runChecks(mocks);

    expect(mocks.memory.checkHeap).toHaveBeenCalledWith('memory_heap', 1024 * MB);
    expect(mocks.memory.checkRSS).toHaveBeenCalledWith('memory_rss', 2048 * MB);
  });

  it('raises the heap threshold above the old 150 MB hardcoded value', async () => {
    const mocks = buildController({});
    await runChecks(mocks);

    const [, heapBytes] = mocks.memory.checkHeap.mock.calls[0];
    expect(heapBytes).toBeGreaterThan(150 * MB);
  });

  it('honours env overrides for both thresholds', async () => {
    const mocks = buildController({
      HEALTH_MEMORY_HEAP_MB: '3072',
      HEALTH_MEMORY_RSS_MB: '4096',
    });
    await runChecks(mocks);

    expect(mocks.memory.checkHeap).toHaveBeenCalledWith('memory_heap', 3072 * MB);
    expect(mocks.memory.checkRSS).toHaveBeenCalledWith('memory_rss', 4096 * MB);
  });

  it('keeps the database check in the probe set', async () => {
    const mocks = buildController({});
    await runChecks(mocks);

    expect(mocks.prismaHealth.isHealthy).toHaveBeenCalledWith('database');
  });
});
