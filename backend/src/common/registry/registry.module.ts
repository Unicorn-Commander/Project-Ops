import { Global, Module } from '@nestjs/common';
import { UcRegistryService } from './uc-registry.service';

/**
 * Provides the (flag-gated, inert-by-default) uc-registry client to the DI
 * container. @Global so any future workspace-creation service can inject
 * UcRegistryService without re-listing it — mirroring how the workspace/membership
 * providers are wired. Depends only on the global ConfigService, so it
 * constructs cleanly and is a pure no-op while UC_REGISTRY_URL is unset (no boot
 * risk on a default-env node).
 *
 * NOTE: the actual workspace-creation paths today are the seed scripts
 * (scripts/seed-phase2-tenancy.ts, tests/integration/rls/seed-rls-fixtures.ts),
 * which are NON-DI and call the pure client (uc-registry.client.ts) directly. PO
 * has no workspace-CRUD-create endpoint, and client-signup JOINS an existing
 * workspace (it does not create one), so there is no DI creation path to wire
 * yet. This provider is the ready seam for when one is added.
 */
@Global()
@Module({
  providers: [UcRegistryService],
  exports: [UcRegistryService],
})
export class RegistryModule {}
