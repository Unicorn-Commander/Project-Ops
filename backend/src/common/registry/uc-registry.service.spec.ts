/**
 * Unit tests for the DI wrapper UcRegistryService. The heavy contract lives in
 * uc-registry.client.spec.ts; here we only prove the wrapper reads ConfigService
 * and stays inert when UC_REGISTRY_URL is unset.
 */
import { ConfigService } from '@nestjs/config';
import { UcRegistryService } from './uc-registry.service';

const config = (vars: Record<string, string | undefined>): ConfigService =>
  ({ get: (k: string) => vars[k] }) as unknown as ConfigService;

const WS = {
  id: '019e50a3-d995-723f-ab66-0f765f92c0f4',
  slug: 'magic-unicorn',
  displayName: 'Magic Unicorn',
  isolationMode: 'standard',
  isolationTier: 'shared',
};

describe('UcRegistryService', () => {
  it('reports disabled + is a no-op when UC_REGISTRY_URL is unset', async () => {
    const svc = new UcRegistryService(config({}));
    expect(svc.enabled).toBe(false);
    const outcome = await svc.registerWorkspace(WS);
    expect(outcome).toEqual({ ok: true, skipped: true, reason: 'disabled' });
  });

  it('reports enabled when UC_REGISTRY_URL is set', () => {
    const svc = new UcRegistryService(config({ UC_REGISTRY_URL: 'http://registry:8081' }));
    expect(svc.enabled).toBe(true);
  });
});
